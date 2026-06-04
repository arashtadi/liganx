/**
 * Post discovery + sort.
 *
 * Vite's import.meta.glob with eager:true bundles every post module at
 * build time, so there's no async lazy-load on the index page. Posts
 * are tiny (~10-30 KB each) so eager-loading the whole catalogue is
 * cheaper than the round-trip to fetch one. We can switch to lazy
 * later if the post count gets into the hundreds.
 *
 * The registry exports `posts` (sorted desc by date) and a
 * `getPost(slug)` lookup. Both consumed by the index + post pages.
 */

import type { ComponentType } from "react";
import type { PostMeta } from "./types";

export interface LoadedPost {
  meta: PostMeta;
  Component: ComponentType;
}

// Import every .tsx file in posts/. Each must `export const meta: PostMeta`
// AND `export default function ComponentName() { ... }`.
const modules = import.meta.glob<{ meta: PostMeta; default: ComponentType }>(
  "./posts/*.tsx",
  { eager: true },
);

function build(): LoadedPost[] {
  const out: LoadedPost[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    if (!mod.meta || !mod.default) {
      // Surface a build-time-ish error so we don't silently drop a
      // post that's missing its frontmatter. Console.error is the
      // cheapest signal that doesn't require a build pipeline change.
      console.error(`[blog] post at ${path} missing meta or default export`);
      continue;
    }
    out.push({ meta: mod.meta, Component: mod.default });
  }
  // Sort newest first. Tie-break alphabetically by slug for determinism.
  out.sort((a, b) => {
    const cmp = b.meta.date.localeCompare(a.meta.date);
    return cmp !== 0 ? cmp : a.meta.slug.localeCompare(b.meta.slug);
  });
  return out;
}

export const posts: LoadedPost[] = build();

export function getPost(slug: string): LoadedPost | undefined {
  return posts.find((p) => p.meta.slug === slug);
}

/** All known slugs — used by the static-sitemap generator script. */
export function allSlugs(): string[] {
  return posts.map((p) => p.meta.slug);
}

/**
 * relatedPosts — pick the N posts most topically related to `slug`.
 *
 * Ranking: number of shared `meta.tags` (descending), tie-broken by
 * recency (newer first). Posts with zero tag overlap are only used as
 * filler to reach N when a post has few siblings, so every post still
 * surfaces a "Related posts" block. This is the automatic internal-linking
 * layer — it cross-links the entire catalogue without editing every post,
 * which is the single highest-leverage, lowest-risk SEO lever for the blog.
 */
export function relatedPosts(slug: string, n = 3): LoadedPost[] {
  const self = getPost(slug);
  if (!self) return posts.slice(0, n);
  const selfTags = new Set((self.meta.tags ?? []).map((t) => t.toLowerCase()));

  const scored = posts
    .filter((p) => p.meta.slug !== slug)
    .map((p) => {
      const overlap = (p.meta.tags ?? []).reduce(
        (acc, t) => acc + (selfTags.has(t.toLowerCase()) ? 1 : 0),
        0,
      );
      return { post: p, overlap };
    });

  scored.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    const cmp = b.post.meta.date.localeCompare(a.post.meta.date);
    return cmp !== 0 ? cmp : a.post.meta.slug.localeCompare(b.post.meta.slug);
  });

  return scored.slice(0, n).map((s) => s.post);
}
