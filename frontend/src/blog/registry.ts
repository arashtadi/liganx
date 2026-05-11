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
