# blog.improvlore.com

Source for the [Improv Lore blog](https://blog.improvlore.com). A standalone
[Eleventy](https://www.11ty.dev/) site that shares the visual design of the main
[improvlore.com](https://improvlore.com) site (same fonts, palette, icons,
background motifs, header, and footer) so it reads as a continuation of it.

## Dev

```bash
npm install
npm run dev    # local server with live reload
npm run build  # one-off build into _site/
```

## Writing posts

Posts are Markdown files in [`src/posts/`](src/posts/). Each needs front matter:

```markdown
---
title: Your post title
date: 2026-06-22
tags:
  - shows        # any topic tag(s); also drives the /tags/ pages
cover: http://dummy.tcdw.org/1200/675/   # cover image (optional)
coverAlt: Description of the cover image
coverCaption: Optional caption shown under the cover
description: Optional summary used for cards, meta, and the feed.
---

Your post body in Markdown.
```

- The filename becomes the URL slug (`my-post.md` → `/my-post/`).
- Layout and the `post` tag are applied automatically via
  [`src/posts/posts.json`](src/posts/posts.json) — you don't set `layout`.
- Reading time and the listing excerpt are derived automatically.

### Images

Both cover images and inline images can be remote URLs. The placeholder service
[`http://dummy.tcdw.org/`](http://dummy.tcdw.org/) serves random images at
`http://dummy.tcdw.org/<width>/<height>/`.

- **Cover:** set `cover:` in front matter.
- **Inline:** standard Markdown — `![alt](http://dummy.tcdw.org/1000/560/ "optional caption")`.

Remote (`http`) images are hotlinked as-is. Local images placed under
`src/assets/` are resized and converted to WebP at build time.

## What gets generated

- `/` — post listing (latest post featured, rest in a grid)
- `/<slug>/` — each post
- `/tags/` — topic index, and `/tags/<topic>/` — posts per topic
- `/feed.xml` — Atom feed · `/sitemap.xml` · `/robots.txt` · `/manifest.webmanifest`
- `/404.html`

## Deploy

Built for Cloudflare Pages (build command `npm run build`, output `_site`).
`npm run deploy` fires a deploy hook (`CF_DEPLOY_HOOK` in a git-ignored `.env`).

## License and usage

Copyright (c) Improv Lore. All rights reserved. Not licensed for reuse; the
Improv Lore branding and content may not be copied or used for a derivative site
without permission.
