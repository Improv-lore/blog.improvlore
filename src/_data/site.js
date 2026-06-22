// Site-wide constants for the blog. `url` is the canonical production origin and
// the single source of truth for the sitemap, RSS, canonical tags, and absolute
// OG image URLs. No trailing slash.
const url = "https://blog.improvlore.com";

export default {
  url,
  name: "Improv Lore Blog",
  // The main site, linked from the header logo and footer so the blog reads as
  // part of improvlore.com rather than a standalone island.
  mainSite: "https://improvlore.com",
  description:
    "Notes, stories, and lessons from Improv Lore — live improv theatre, jams, and workshops in Bangalore and beyond.",
  year: new Date().getFullYear(),

  // Resolve a path or possibly-relative URL to an absolute URL on this origin.
  // Pass-through for anything already absolute (remote post images). Used for
  // og:image, sitemap, and RSS so crawlers and social cards never see a
  // root-relative path.
  absUrl(pathOrUrl = "") {
    if (!pathOrUrl) return url;
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return url + (pathOrUrl.startsWith("/") ? "" : "/") + pathOrUrl;
  },
};
