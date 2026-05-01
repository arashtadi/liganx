/**
 * usePageMeta — per-route SEO hook.
 *
 * Liganx is a Vite SPA, so every route ships the same static index.html
 * <head>. That's fine for the homepage, but every other route would tell
 * Google "Liganx — Free molecular docking online · Vina + GNINA + Boltz-2 ·
 * Mutation-aware" no matter what page Google was crawling. That kills our
 * chance of ranking for long-tail queries that map to specific surfaces
 * (the validation page, the curated library, the privacy page, etc.).
 *
 * This hook patches <title>, <meta name="description">, the canonical
 * link, and the og/twitter title+description+url fields when a route
 * mounts. On unmount we restore the original values from index.html so
 * routes that don't call the hook still see the homepage defaults.
 *
 * We deliberately don't pull in react-helmet-async — it would add a
 * provider, a runtime, and one more thing for the bundle to ship for
 * what is, structurally, four DOM mutations. The render-after-mount
 * timing is fine: Googlebot now executes JS and waits for the rendered
 * head before snapshotting (see "Mobile-First Indexing & JS rendering"
 * docs from 2024). Bing/DuckDuckGo are catching up; if we ever need
 * fully static SSR for a specific bot we'll prerender just the
 * marketing routes via a vite-plugin-prerender pass at build time.
 */

import { useEffect } from "react";

export interface PageMeta {
  /** Full <title> string. Keep under ~60 chars so Google doesn't truncate
   *  in the SERP. Brand suffix ("· Liganx") is optional — many of our
   *  routes already include "Liganx" naturally and stuffing it twice hurts. */
  title: string;
  /** Meta description. Google clips at ~155-160 chars on desktop and ~120
   *  on mobile — write the most important info first. */
  description: string;
  /** Optional canonical override. Defaults to the current pathname under
   *  https://liganx.com so subdomain or query-string variants collapse to
   *  the canonical URL. Pass an absolute URL when the canonical lives on
   *  a different page (e.g. paginated archives → page 1). */
  canonical?: string;
  /** Optional og:image override. Defaults to the homepage og-image.png. */
  ogImage?: string;
}

const SITE_ORIGIN = "https://liganx.com";
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;

function setMeta(selector: string, attr: "content" | "href", value: string) {
  const el = document.head.querySelector(selector) as HTMLMetaElement | HTMLLinkElement | null;
  if (el) {
    el.setAttribute(attr, value);
    return;
  }
  // No element to patch — create it. Used for routes that need a tag the
  // base index.html doesn't ship (rare, but safe to handle).
  const isLink = selector.startsWith("link");
  const created = document.createElement(isLink ? "link" : "meta") as HTMLLinkElement | HTMLMetaElement;
  // Selector is shaped like 'meta[name="description"]' or 'link[rel="canonical"]' —
  // strip the tag prefix and unwrap the attribute predicate to recover the
  // attr/value pair. Cheap and correct for our usage.
  const match = selector.match(/\[(\w[\w-]*)="([^"]+)"\]/);
  if (match) {
    created.setAttribute(match[1], match[2]);
  }
  created.setAttribute(attr, value);
  document.head.appendChild(created);
}

export function usePageMeta(meta: PageMeta) {
  useEffect(() => {
    // Snapshot what was in the head BEFORE we touch it so we can put it
    // back on unmount. This matters if the user navigates from a deep
    // route back to "/" — the homepage relies on index.html's defaults
    // and doesn't call the hook itself.
    const prev = {
      title: document.title,
      description:
        document.head.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
      canonical:
        document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
      ogTitle:
        document.head.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "",
      ogDescription:
        document.head.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "",
      ogUrl:
        document.head.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? "",
      ogImage:
        document.head.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "",
      twitterTitle:
        document.head.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ?? "",
      twitterDescription:
        document.head.querySelector('meta[name="twitter:description"]')?.getAttribute("content") ?? "",
      twitterImage:
        document.head.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ?? "",
    };

    const canonical = meta.canonical ?? `${SITE_ORIGIN}${window.location.pathname}`;
    const ogImage = meta.ogImage ?? DEFAULT_OG_IMAGE;

    document.title = meta.title;
    setMeta('meta[name="description"]', "content", meta.description);
    setMeta('link[rel="canonical"]', "href", canonical);
    setMeta('meta[property="og:title"]', "content", meta.title);
    setMeta('meta[property="og:description"]', "content", meta.description);
    setMeta('meta[property="og:url"]', "content", canonical);
    setMeta('meta[property="og:image"]', "content", ogImage);
    setMeta('meta[name="twitter:title"]', "content", meta.title);
    setMeta('meta[name="twitter:description"]', "content", meta.description);
    setMeta('meta[name="twitter:image"]', "content", ogImage);

    return () => {
      document.title = prev.title;
      setMeta('meta[name="description"]', "content", prev.description);
      if (prev.canonical) setMeta('link[rel="canonical"]', "href", prev.canonical);
      setMeta('meta[property="og:title"]', "content", prev.ogTitle);
      setMeta('meta[property="og:description"]', "content", prev.ogDescription);
      setMeta('meta[property="og:url"]', "content", prev.ogUrl);
      setMeta('meta[property="og:image"]', "content", prev.ogImage);
      setMeta('meta[name="twitter:title"]', "content", prev.twitterTitle);
      setMeta('meta[name="twitter:description"]', "content", prev.twitterDescription);
      setMeta('meta[name="twitter:image"]', "content", prev.twitterImage);
    };
    // We intentionally re-run the effect when any meta field changes so
    // pages can update their own title in response to data load (e.g.
    // JobPage showing the target name once it's fetched).
  }, [meta.title, meta.description, meta.canonical, meta.ogImage]);
}
