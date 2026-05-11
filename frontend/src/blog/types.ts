/**
 * Blog post types.
 *
 * Each post lives at frontend/src/blog/posts/<slug>.tsx and exports:
 *   - `meta: PostMeta` (frontmatter)
 *   - default-exported React component (the post body)
 *
 * The registry (./registry.ts) discovers all posts via Vite's
 * import.meta.glob and sorts them by date desc for the index page.
 *
 * We deliberately use .tsx instead of .md so:
 *   - SEO crawlers see real HTML in the source bundle (no markdown
 *     library needs to run in the browser before content is visible)
 *   - posts can embed live React components (data tables, embedded
 *     3D viewers, "dock this on Liganx" CTAs that link straight into
 *     /studio with a reseed payload)
 *   - typecheck catches typos in slugs/dates at build time
 */

export interface PostMeta {
  /** URL slug — e.g. "kras-g12c-clinical-landscape". Used in /blog/<slug>.
   *  Must be kebab-case, ASCII, unique across posts. The filename should
   *  match the slug for grep-ability. */
  slug: string;

  /** Headline shown on the index card and as <h1> on the post page.
   *  Drives <title> too — keep under ~70 chars so Google doesn't truncate. */
  title: string;

  /** One-sentence summary shown in the index list, in the meta description,
   *  and in OG/Twitter cards. ~140-160 chars is the sweet spot. */
  description: string;

  /** ISO date string (YYYY-MM-DD). Drives sorting AND the JSON-LD
   *  datePublished field. Use the date the post was first published;
   *  add a separate `updated` field if you revise it later. */
  date: string;

  /** Optional ISO date for the most recent material edit. Surfaces in
   *  JSON-LD as dateModified — Google likes seeing this for fresh content. */
  updated?: string;

  /** Author name (free-form). Defaults handled by post page if omitted. */
  author?: string;

  /** Topical tags — drives faceted browsing later AND helps Google
   *  understand the topic cluster. Free-form lowercase strings,
   *  hyphenated. Keep under 5 per post. */
  tags?: string[];

  /** Estimated reading time in minutes. Used for the "5 min read" badge
   *  on the index card. Eyeballed by author rather than computed because
   *  scientific posts read slower than the formula assumes. */
  readingMin?: number;

  /** Optional hero/thumb image URL — relative to /public or absolute.
   *  Used as og:image for the post; falls back to site-wide og-image.png. */
  hero?: string;
}
