/**
 * useJsonLd — inject a JSON-LD <script> tag into the document head.
 *
 * Why: Google's structured-data crawler reads <script type="application/ld+json">
 * to populate rich-result cards (Article snippets, breadcrumb trails,
 * FAQ accordions, etc.). For a blog post, an `Article` schema with
 * datePublished + author + headline gets the post into the "Top Stories"
 * carousel for niche topics, AND it makes the SERP entry richer
 * (date stamp, author byline, sometimes a thumbnail).
 *
 * Pattern matches usePageMeta — mount creates the tag, unmount removes
 * it, so navigating between routes doesn't leave stale schema in the
 * head. A unique id (per data-jsonld-id) lets us target our own tag
 * without disturbing any other JSON-LD an SDK might inject.
 */

import { useEffect } from "react";

/** Marker attribute we set on every script element this hook creates,
 *  so the cleanup function can find/remove ONLY tags we made. */
const MARKER_ATTR = "data-jsonld-id";

export function useJsonLd(id: string, data: unknown) {
  useEffect(() => {
    if (!id || data == null) return;
    // Remove any prior tag with the same id (happens when a route's
    // useJsonLd args change without an unmount, e.g. the post slug
    // changes inside BlogPostPage). Idempotent — safe to call before
    // every insert.
    const existing = document.head.querySelector(`script[${MARKER_ATTR}="${id}"]`);
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute(MARKER_ATTR, id);
    // JSON.stringify is intentional here — Google's parser is strict
    // about quoting and escaping. Pretty-printing with indent=2 trades
    // a few bytes for better debuggability if you View Source.
    script.text = JSON.stringify(data, null, 2);
    document.head.appendChild(script);

    return () => {
      const el = document.head.querySelector(`script[${MARKER_ATTR}="${id}"]`);
      if (el) el.remove();
    };
  }, [id, data]);
}
