// Custom markdown-it rules for the Improv Lore blog. Extracted into this shared
// module (out of .eleventy.js) so the SAME implementation can be used by both the
// static build here and the write.improvlore live-preview editor — one source of
// truth, no drift between "what I edit" and "what ships".
//
// Usage (Eleventy):
//   import { improvloreRules } from "./src/markdown-rules.js";
//   eleventyConfig.amendLibrary("md", (md) => improvloreRules(md, { ignoreRemoteImages: true }));
//
// Usage (plain markdown-it, e.g. the editor preview):
//   const md = new MarkdownIt(...).use(improvloreRules);
//
// Options:
//   ignoreRemoteImages — (build only) tag http(s) images with `eleventy:ignore`
//     so Eleventy's image transform skips them. The editor omits this (no
//     optimiser), so it defaults to false.
//
// Rules / author syntax:
//   ![alt =half](url)      per-image sizing  -> <img class="img-half">
//   @ Wed, 17th June.      event-date line   -> <p class="event-date">
//   !!text!!               title highlight   -> <mark class="title-mark">
//   :::collage cols=2 ...  image grid/row    -> <div class="collage">

const IMG_SIZES = new Set(["third", "half", "two-thirds", "wide", "full"]);
const SIZE_TOKEN_RE = /\s*=([a-z-]+)\s*$/i;
const EVENT_DATE_RE = /^@\s+/;
const COLLAGE_OPEN_RE = /^:::collage((?:\s+(?:cols?=\d+|row))*)\s*$/;

export function improvloreRules(md, opts = {}) {
    const ignoreRemoteImages = !!opts.ignoreRemoteImages;

    // ---- Per-image sizing: `![alt =half](url)` -------------------------------
    const defaultImage =
        md.renderer.rules.image ||
        ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx];

        // Build only: mark remote images so Eleventy's optimiser skips them.
        if (ignoreRemoteImages) {
            const src = token.attrGet("src") || "";
            if (/^https?:\/\//i.test(src) && token.attrIndex("eleventy:ignore") < 0) {
                token.attrPush(["eleventy:ignore", ""]);
            }
        }

        // A trailing `=size` token in the alt text sets a width class and is
        // stripped from the rendered alt so it never shows to readers.
        const m = token.content.match(SIZE_TOKEN_RE);
        if (m && IMG_SIZES.has(m[1].toLowerCase())) {
            const size = m[1].toLowerCase();
            token.content = token.content.replace(SIZE_TOKEN_RE, "");
            const lastChild = token.children && token.children[token.children.length - 1];
            if (lastChild && lastChild.type === "text") {
                lastChild.content = lastChild.content.replace(SIZE_TOKEN_RE, "");
            }
            token.attrJoin("class", `img-${size}`);
        }
        return defaultImage(tokens, idx, options, env, self);
    };

    // ---- Event-date line: a paragraph starting with `@ ` ----------------------
    // `@ Wed, 17th June.` is the date under an event heading. Strip the marker
    // from the first inline token and tag the paragraph `class="event-date"`.
    md.core.ruler.push("event_date", (state) => {
        const tokens = state.tokens;
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type !== "paragraph_open") continue;
            const inline = tokens[i + 1];
            const first = inline && inline.children && inline.children[0];
            if (!first || first.type !== "text" || !EVENT_DATE_RE.test(first.content)) continue;
            first.content = first.content.replace(EVENT_DATE_RE, "");
            tokens[i].attrJoin("class", "event-date");
        }
    });

    // ---- Title highlight: `!! ... !!` -> <mark class="title-mark"> -------------
    // Inner content is re-tokenised, so links/emphasis inside the marker work.
    md.inline.ruler.before("emphasis", "title_mark", (state, silent) => {
        const start = state.pos;
        const src = state.src;
        if (src.charCodeAt(start) !== 0x21 /* ! */ || src.charCodeAt(start + 1) !== 0x21) {
            return false;
        }
        const close = src.indexOf("!!", start + 2);
        if (close < 0) return false;
        if (!silent) {
            state.push("title_mark_open", "mark", 1).attrSet("class", "title-mark");
            const oldMax = state.posMax;
            state.pos = start + 2;
            state.posMax = close;
            state.md.inline.tokenize(state);
            state.pos = close;
            state.posMax = oldMax;
            state.push("title_mark_close", "mark", -1);
        }
        state.pos = close + 2;
        return true;
    });

    // ---- External links open in a new tab -------------------------------------
    // Any http(s) link (i.e. off-site) gets target="_blank" + rel="noopener" so
    // readers don't lose the post. Relative/internal links are left alone.
    const defaultLinkOpen =
        md.renderer.rules.link_open ||
        ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const href = tokens[idx].attrGet("href") || "";
        if (/^https?:\/\//i.test(href)) {
            tokens[idx].attrSet("target", "_blank");
            tokens[idx].attrSet("rel", "noopener");
        }
        return defaultLinkOpen(tokens, idx, options, env, self);
    };

    // ---- Collage fence: `:::collage [cols=N] [row]` … `:::` --------------------
    md.block.ruler.before("fence", "collage", (state, startLine, endLine, silent) => {
        const startPos = state.bMarks[startLine] + state.tShift[startLine];
        const startMax = state.eMarks[startLine];
        const open = COLLAGE_OPEN_RE.exec(state.src.slice(startPos, startMax));
        if (!open) return false;
        if (silent) return true;

        // Find the closing `:::` line.
        let closeLine = -1;
        for (let n = startLine + 1; n < endLine; n++) {
            const pos = state.bMarks[n] + state.tShift[n];
            const max = state.eMarks[n];
            if (state.src.slice(pos, max).trim() === ":::") { closeLine = n; break; }
        }
        if (closeLine < 0) return false;

        const opts2 = open[1] || "";
        const isRow = /\brow\b/.test(opts2);
        const colsMatch = opts2.match(/cols?=(\d+)/);
        const open_t = state.push("collage_open", "div", 1);
        open_t.attrSet("class", isRow ? "collage collage-row" : "collage");
        if (colsMatch && !isRow) open_t.attrSet("style", `--collage-cols:${colsMatch[1]}`);
        open_t.block = true;
        open_t.map = [startLine, closeLine];

        const oldParent = state.parentType;
        const oldLineMax = state.lineMax;
        state.lineMax = closeLine;
        state.md.block.tokenize(state, startLine + 1, closeLine);
        state.lineMax = oldLineMax;
        state.parentType = oldParent;

        state.push("collage_close", "div", -1).block = true;
        state.line = closeLine + 1;
        return true;
    });

    // ---- Collage paragraph split ---------------------------------------------
    // Consecutive image lines with no blank line between them parse into one <p>,
    // which would make a collage a single grid cell. Split any multi-image
    // paragraph inside a collage so each image becomes its own <p> (one cell).
    md.core.ruler.push("collage_split", (state) => {
        const Token = state.Token;
        const tokens = state.tokens;
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type !== "collage_open") continue;
            for (let j = i + 1; tokens[j] && tokens[j].type !== "collage_close"; j++) {
                if (tokens[j].type !== "inline") continue;
                const imgs = (tokens[j].children || []).filter((c) => c.type === "image");
                if (imgs.length < 2) continue;

                const replacement = [];
                for (const img of imgs) {
                    const pOpen = new Token("paragraph_open", "p", 1);
                    pOpen.block = true;
                    const inline = new Token("inline", "", 0);
                    inline.children = [img];
                    inline.content = img.content || "";
                    const pClose = new Token("paragraph_close", "p", -1);
                    pClose.block = true;
                    replacement.push(pOpen, inline, pClose);
                }
                tokens.splice(j - 1, 3, ...replacement);
                j = j - 1 + replacement.length - 1;
            }
        }
    });
}
