import { dateToRfc3339 } from "@11ty/eleventy-plugin-rss";
import { eleventyImageTransformPlugin } from "@11ty/eleventy-img";
import fs from "fs";
import { improvloreRules } from "./src/markdown-rules.js";

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

    // The blog's custom markdown rules (=size images, @ event-date, !! title
    // highlight, :::collage) live in a shared module so write.improvlore can use
    // the identical implementation for its live preview — one source of truth.
    // `ignoreRemoteImages` is the one build-only concern: it tags http(s) images
    // with `eleventy:ignore` so the image transform below skips them (posts
    // hotlink remote photos; local images under src/assets/ are still optimised).
    eleventyConfig.amendLibrary("md", (md) =>
        improvloreRules(md, { ignoreRemoteImages: true })
    );

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

    // Downsize remote post photos (img.improvlore.com) via Cloudflare Image
    // Resizing. Originals are full-resolution phone photos that load slowly;
    // left alone they also bloat the page. This HTML transform runs after render
    // and rewrites every img.improvlore.com <img src> — cover and body alike —
    // through /cdn-cgi/image/. We cap both width and height with fit=scale-down,
    // so photos keep their natural aspect ratio (nothing cropped) but tall/wide
    // outliers shrink toward a common size instead of towering over neighbours;
    // collage rows further equalize by sharing a height in CSS. Already-resized
    // URLs (/cdn-cgi/image/) and other hosts are untouched.
    eleventyConfig.addTransform("resizeRemotePhotos", function (content) {
        if (!(this.page.outputPath || "").endsWith(".html")) return content;
        return content.replace(
            /(<img\b[^>]*?\bsrc=")(https?:\/\/img\.improvlore\.com\/)([^"]+)(")/gi,
            (full, pre, host, path, post) => {
                if (path.startsWith("cdn-cgi/image/")) return full;
                const opts = "width=1400,height=1050,fit=scale-down,quality=80,format=auto";
                return `${pre}${host}cdn-cgi/image/${opts}/${path}${post}`;
            }
        );
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

    // Normalize a post's author front matter into a uniform [{name, url}] list,
    // so the byline and JSON-LD have one source of truth and posts can credit
    // more than one writer. Accepted front-matter shapes, in priority order:
    //   authors: [{ name, url }, ...]        ← preferred for multiple authors
    //   author: "Name"  (+ optional authorUrl)   ← legacy single author
    //   author: "Name One, Name Two"          ← comma-separated names; a lone
    //                                            authorUrl only applies when
    //                                            there's a single name.
    eleventyConfig.addFilter("authorList", (authors, author, authorUrl) => {
        if (Array.isArray(authors)) {
            return authors
                .map((a) =>
                    typeof a === "string"
                        ? { name: a.trim(), url: "" }
                        : { name: (a.name || "").trim(), url: a.url || "" }
                )
                .filter((a) => a.name);
        }
        if (typeof author === "string" && author.trim()) {
            const names = author.split(",").map((n) => n.trim()).filter(Boolean);
            return names.map((name, i) => ({
                name,
                // A single authorUrl can't be attributed to a specific person
                // when several are listed, so only apply it to a lone author.
                url: names.length === 1 && i === 0 ? authorUrl || "" : "",
            }));
        }
        return [];
    });

    // A social-card-sized variant of a cover image for og:image / twitter:image.
    // Originals on img.improvlore.com can be multi-megabyte PNGs, which social
    // scrapers (WhatsApp, Facebook, X, LinkedIn) refuse to fetch or silently
    // drop. That host is Cloudflare-backed and supports Image Resizing, so we
    // route the URL through /cdn-cgi/image/ to get a ~1200×630 JPEG that's a few
    // hundred KB at most. Non-img.improvlore.com or already-resized URLs (and
    // local paths) are returned untouched.
    eleventyConfig.addFilter("ogCard", (url) => {
        if (!url) return url;
        const m = /^https?:\/\/img\.improvlore\.com\/(.+)$/i.exec(url);
        if (!m || url.includes("/cdn-cgi/image/")) return url;
        const opts = "width=1200,height=630,fit=cover,quality=80,format=auto";
        return `https://img.improvlore.com/cdn-cgi/image/${opts}/${m[1]}`;
    });

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
    const TAG_NOISE = new Set(["all", "post", "posts", "community"]);

    // All real topic tags on a post, minus the bookkeeping ones (for the JSON API).
    eleventyConfig.addFilter("cleanTags", (tags) =>
        (tags || []).filter((t) => !TAG_NOISE.has(t))
    );

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

    // The "post" collection: our own native posts under src/posts/, oldest-first
    // by date (templates reverse it for display). Republished posts (other
    // writers' pieces re-hosted here, marked `republished: true`) render their
    // own full page but are kept out of this collection — they live only in the
    // "community" collection below, so they don't mix into the home listing/feed.
    eleventyConfig.addCollection("post", (collectionApi) =>
        collectionApi
            .getFilteredByGlob("src/posts/**/*.md")
            .filter((item) => !item.data.republished)
            .sort((a, b) => a.date - b.date)
    );

    // The "community" collection: republished posts — earlier pieces from other
    // people's blogs/Substacks, pasted in here and rendered as full pages with a
    // credit banner. Surfaced under /community/ ("From the Community"). Oldest-
    // first by date; templates reverse it for display.
    eleventyConfig.addCollection("community", (collectionApi) =>
        collectionApi
            .getFilteredByGlob("src/posts/**/*.md")
            .filter((item) => item.data.republished)
            .sort((a, b) => a.date - b.date)
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
