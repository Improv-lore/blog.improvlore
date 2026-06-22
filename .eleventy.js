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
        md.renderer.rules.image = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            const src = token.attrGet("src") || "";
            if (/^https?:\/\//i.test(src) && token.attrIndex("eleventy:ignore") < 0) {
                token.attrPush(["eleventy:ignore", ""]);
            }
            return defaultImage(tokens, idx, options, env, self);
        };
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
