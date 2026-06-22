import { dateToRfc3339 } from "@11ty/eleventy-plugin-rss";
import { eleventyImageTransformPlugin } from "@11ty/eleventy-img";
import fs from "fs";

export default function(eleventyConfig) {
    eleventyConfig.addPassthroughCopy({"src/assets": "assets"});

    // Inline the chrome CSS into <head> the same way the main site does, so the
    // blog ships identical styling with no render-blocking stylesheet request.
    eleventyConfig.addFilter("inlineCss", function(filePath) {
        if (!fs.existsSync(filePath)) return "";
        const raw = fs.readFileSync(filePath, "utf8");
        return raw
            .replace(/\/\*[\s\S]*?\*\//g, '') // strip comments
            .replace(/\s+/g, ' ')             // collapse whitespace
            .replace(/\{\s+/g, '{')
            .replace(/\}\s+/g, '}')
            .replace(/;\s+/g, ';')
            .replace(/,\s+/g, ',')
            .trim();
    });

    // Mark every absolute-URL image (http/https) with `eleventy:ignore` so the
    // image transform below skips it. Posts pull placeholder photos from
    // dummy.tcdw.org for now (covers and inline alike); those stay hotlinked as
    // plain <img> tags, so the build never depends on that host being reachable.
    // Local images under src/assets/ have no scheme here and so are still
    // optimised. We extend markdown-it's default image renderer rather than
    // replace it, so alt text, titles, and other attributes are untouched.
    eleventyConfig.amendLibrary("md", (md) => {
        const defaultImage =
            md.renderer.rules.image ||
            ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
        // Per-image sizing via a `=size` token in the alt text, e.g.
        // `![crowd =half](url)`. Recognised sizes map to `.img-<size>` classes
        // that blog.css widths. The token is stripped from the rendered alt so
        // it never shows up as a caption or to screen readers.
        const IMG_SIZES = new Set(["third", "half", "two-thirds", "wide", "full"]);
        const SIZE_TOKEN_RE = /\s*=([a-z-]+)\s*$/i;
        md.renderer.rules.image = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            const src = token.attrGet("src") || "";
            if (/^https?:\/\//i.test(src) && token.attrIndex("eleventy:ignore") < 0) {
                token.attrPush(["eleventy:ignore", ""]);
            }
            // Alt text is `token.content`; markdown-it also keeps it as inline
            // children. Pull a trailing `=size` off both so the alt stays clean.
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

        // Event-date lines. A paragraph that begins with a literal `@ ` (e.g.
        // `@ Wed, 17th June.`) is the date for the heading above it. We strip the
        // marker from the first inline token and tag the paragraph with
        // `class="event-date"` so blog.css can style it as a tight, muted caption.
        // A paragraph's opening text lives in the inline token's first child;
        // editing it there keeps any later inline formatting on the line intact.
        const EVENT_DATE_RE = /^@\s+/;
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

        // Title highlight. Text wrapped in `!! ... !!` (e.g. a heading's event
        // title: `!![Whimsical Wednesday](url)!!`) renders as
        // <mark class="title-mark">…</mark>, which blog.css styles as the big,
        // bold, yellow-highlighted title. We emit open/close tokens and let
        // markdown-it keep tokenising the inner run, so links/emphasis inside
        // the marker still work. Opt-in, and not limited to headings.
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

        // Collage fence. A block wrapped in `:::collage` … `:::` lays its images
        // out as an even responsive grid. Options on the opening line, any order:
        //   cols=N  fix the column count (otherwise the grid auto-fits)
        //   row     one equal-height justified row instead of a grid; images
        //           share a height and keep their own widths (no wrapping)
        // The inner lines are parsed as normal Markdown, so each `![alt](url)`
        // becomes an image (per-image `=size` tokens still apply in grid mode).
        const COLLAGE_OPEN_RE = /^:::collage((?:\s+(?:cols?=\d+|row))*)\s*$/;
        md.block.ruler.before("fence", "collage", (state, startLine, endLine, silent) => {
            const startPos = state.bMarks[startLine] + state.tShift[startLine];
            const startMax = state.eMarks[startLine];
            const openLine = state.src.slice(startPos, startMax);
            const open = COLLAGE_OPEN_RE.exec(openLine);
            if (!open) return false;
            if (silent) return true;

            // Find the closing `:::` line.
            let nextLine = startLine + 1;
            let closeLine = -1;
            for (; nextLine < endLine; nextLine++) {
                const pos = state.bMarks[nextLine] + state.tShift[nextLine];
                const max = state.eMarks[nextLine];
                if (state.src.slice(pos, max).trim() === ":::") {
                    closeLine = nextLine;
                    break;
                }
            }
            if (closeLine < 0) return false;

            const opts = open[1] || "";
            const isRow = /\brow\b/.test(opts);
            const colsMatch = opts.match(/cols?=(\d+)/);
            const open_t = state.push("collage_open", "div", 1);
            open_t.attrSet("class", isRow ? "collage collage-row" : "collage");
            // cols= is meaningful for the grid; a row is always a single line.
            if (colsMatch && !isRow) open_t.attrSet("style", `--collage-cols:${colsMatch[1]}`);
            open_t.block = true;
            open_t.map = [startLine, closeLine];

            // Tokenise the lines between the fences as block content.
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

        // Consecutive image lines with no blank line between them parse into a
        // single paragraph (the images become siblings inside one <p>), which
        // would make a collage one grid cell instead of one-per-image. After
        // inline parsing, walk each collage and split any multi-image paragraph
        // so every image gets its own <p> wrapper — one grid/flex item each.
        // Images are separated inside the inline run by softbreak/text tokens;
        // we slice the children on image boundaries into fresh paragraphs.
        md.core.ruler.push("collage_split", (state) => {
            const Token = state.Token;
            const tokens = state.tokens;
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].type !== "collage_open") continue;
                for (let j = i + 1; tokens[j] && tokens[j].type !== "collage_close"; j++) {
                    if (tokens[j].type !== "inline") continue;
                    const imgs = (tokens[j].children || []).filter((c) => c.type === "image");
                    if (imgs.length < 2) continue; // already one image per paragraph

                    // Build a paragraph_open / inline / paragraph_close triple
                    // per image, and splice them in place of this paragraph.
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
                    // Replace [paragraph_open(j-1), inline(j), paragraph_close(j+1)].
                    tokens.splice(j - 1, 3, ...replacement);
                    j = j - 1 + replacement.length - 1;
                }
            }
        });
    });

    // Resize and serve modern WebP (with a JPEG fallback) for our own local
    // images at build time. This runs as an HTML transform so it rewrites every
    // local <img> after render, including ones produced inside Nunjucks macros
    // or Markdown. Remote images carry `eleventy:ignore` (set above for posts,
    // and inline in the layouts for covers/logo/motifs) so they're left as plain
    // hotlinked tags — there's nothing durable to optimise on a remote host.
    eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
        extensions: "html",
        formats: ["webp", "jpeg"],
        widths: [400, 800, 1200],
        urlPath: "/assets/img/",
        outputDir: "_site/assets/img/",
        sharpJpegOptions: { quality: 78, mozjpeg: true },
        sharpWebpOptions: { quality: 72 },
        defaultAttributes: {
            loading: "lazy",
            decoding: "async",
        },
    });

    // ---- Date helpers --------------------------------------------------------
    // Posts carry an ISO `date` in front matter. Render it as a friendly label
    // for the byline, and as an ISO machine date for <time datetime>.
    const fmtDate = (d, opts) =>
        new Intl.DateTimeFormat("en-GB", opts).format(d instanceof Date ? d : new Date(d));

    eleventyConfig.addFilter("readableDate", (d) =>
        fmtDate(d, { day: "numeric", month: "long", year: "numeric" })
    );
    eleventyConfig.addFilter("isoDate", (d) =>
        (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10)
    );
    eleventyConfig.addFilter("dateToRfc3339", (d) =>
        dateToRfc3339(d instanceof Date ? d : new Date(d))
    );

    // Newest first, for the post listing and the feed.
    eleventyConfig.addFilter("reverse", (arr) => [...arr].reverse());

    // Rough reading time from the rendered post body.
    eleventyConfig.addFilter("readingTime", (content) => {
        const text = String(content).replace(/<[^>]+>/g, " ");
        const words = (text.match(/\S+/g) || []).length;
        return Math.max(1, Math.round(words / 200));
    });

    // Plain-text excerpt for cards / meta descriptions when a post sets no
    // explicit `description`. Strips tags and clamps to ~character length.
    eleventyConfig.addFilter("excerpt", (content, len = 160) => {
        const text = String(content).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (text.length <= len) return text;
        return text.slice(0, len).replace(/\s+\S*$/, "") + "…";
    });

    // The bookkeeping tags that aren't real topics.
    const TAG_NOISE = new Set(["all", "post", "posts"]);

    // First real topic tag on a post, for the badge on listing cards.
    eleventyConfig.addFilter("displayTag", (tags) =>
        (tags || []).find((t) => !TAG_NOISE.has(t)) || "Post"
    );

    // Tag list across all posts, minus the bookkeeping tags, for the tag index.
    eleventyConfig.addFilter("postTags", (collections) => {
        const tags = new Set();
        for (const item of collections.post || []) {
            for (const tag of item.data.tags || []) {
                if (!TAG_NOISE.has(tag)) tags.add(tag);
            }
        }
        return [...tags].sort();
    });

    // The "post" collection: everything under src/posts/, oldest-first by date
    // (templates reverse it for display).
    eleventyConfig.addCollection("post", (collectionApi) =>
        collectionApi.getFilteredByGlob("src/posts/*.md").sort((a, b) => a.date - b.date)
    );

    return {
        dir: {
            input: "src",
            output: "_site",
            includes: "layouts"
        },
        markdownTemplateEngine: "njk",
        htmlTemplateEngine: "njk"
    };
}
