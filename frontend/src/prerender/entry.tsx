/**
 * Prerender entry — server-only module loaded by scripts/prerender.mjs via
 * Vite's SSR pipeline (vite.ssrLoadModule). It renders the blog routes to
 * static HTML strings at build time so crawlers and social scrapers see real
 * content + internal links + per-post metadata WITHOUT executing JavaScript.
 *
 * This file runs in plain Node (no DOM). It must only import window-safe
 * modules: the registry, the shared BlogArticleBody, react-dom/server, and
 * react-router's StaticRouter. It must NOT import App.tsx, page components
 * that touch window, or the 3D viewer.
 *
 * The runtime SPA (main.tsx -> createRoot().render) replaces #root on load,
 * so the prerendered HTML is purely progressive enhancement — there is no
 * hydration (createRoot, not hydrateRoot), so a non-matching tree is fine.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import BlogArticleBody from "../blog/BlogArticleBody";
import { posts, getPost, allSlugs } from "../blog/registry";
import type { PostMeta } from "../blog/types";

const SITE = "https://liganx.com";

export const slugs: string[] = allSlugs();

export interface Rendered {
  /** Inner HTML to inject into <div id="root"> */
  html: string;
  /** Full <title> text */
  title: string;
  /** Meta description */
  description: string;
  /** Canonical URL */
  canonical: string;
  /** JSON-LD blocks (already JSON.stringified) to inject before </head> */
  jsonLd: string[];
}

function blogPostingJsonLd(meta: PostMeta, url: string): string {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: meta.title,
    description: meta.description,
    url,
    datePublished: meta.date,
    dateModified: meta.updated ?? meta.date,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image:
      meta.hero
        ? meta.hero.startsWith("http")
          ? meta.hero
          : `${SITE}${meta.hero}`
        : `${SITE}/og-image.png`,
    publisher: { "@type": "Organization", name: "Liganx", url: SITE },
  };
  if (meta.author) {
    data.author = {
      "@type": "Organization",
      name: meta.author,
      url: `${SITE}/about`,
    };
  }
  if (meta.tags && meta.tags.length > 0) {
    data.keywords = meta.tags.join(", ");
  }
  return JSON.stringify(data, null, 2);
}

function breadcrumbJsonLd(meta: PostMeta, url: string): string {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog` },
        { "@type": "ListItem", position: 3, name: meta.title, item: url },
      ],
    },
    null,
    2,
  );
}

/** Render a single blog post to static HTML + head fields. */
export function renderPost(slug: string): Rendered | null {
  const post = getPost(slug);
  if (!post) return null;
  const { meta } = post;
  const url = `${SITE}/blog/${slug}`;
  const html = renderToStaticMarkup(
    <StaticRouter location={`/blog/${slug}`}>
      <BlogArticleBody post={post} />
    </StaticRouter>,
  );
  return {
    html,
    title: `${meta.title} · Liganx blog`,
    description: meta.description,
    canonical: url,
    jsonLd: [blogPostingJsonLd(meta, url), breadcrumbJsonLd(meta, url)],
  };
}

/** Render the /blog index (a crawlable list of every post). */
export function renderIndex(): Rendered {
  const url = `${SITE}/blog`;
  const html = renderToStaticMarkup(
    <StaticRouter location="/blog">
      <main className="max-w-3xl mx-auto py-10 px-4 sm:px-6">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Liganx blog
        </h1>
        <p className="mt-3 text-lg text-slate-600 dark:text-slate-400">
          Drug targets, resistance mutations, ADMET properties, and molecular
          docking methodology — written for researchers in structure-based
          drug discovery.
        </p>
        <ul className="mt-8 space-y-6">
          {posts.map((p) => (
            <li key={p.meta.slug}>
              <a href={`/blog/${p.meta.slug}`}>
                <h2 className="text-xl font-semibold">{p.meta.title}</h2>
              </a>
              <p className="mt-1 text-slate-600 dark:text-slate-400">
                {p.meta.description}
              </p>
            </li>
          ))}
        </ul>
      </main>
    </StaticRouter>,
  );
  const itemList = JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: posts.map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE}/blog/${p.meta.slug}`,
        name: p.meta.title,
      })),
    },
    null,
    2,
  );
  return {
    html,
    title: "Liganx blog — molecular docking, mutations, and ADMET",
    description:
      "Technical posts on drug targets, resistance mutations, ADMET properties, and molecular docking methodology from the Liganx team.",
    canonical: url,
    jsonLd: [itemList],
  };
}
