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
import { AuthCtx } from "../lib/auth";
import type { AuthState } from "../lib/auth";
import HomePage from "../pages/HomePage";
import AboutPage from "../pages/AboutPage";
import MutationDockingGuidePage from "../pages/MutationDockingGuidePage";
import PrivacyPage from "../pages/PrivacyPage";
import TermsPage from "../pages/TermsPage";

const SITE = "https://liganx.com";

// Static, logged-out auth context for prerendering. The real AuthProvider runs
// window/localStorage effects that don't exist in Node; marketing pages only
// read `user` (to toggle a sign-in CTA), so a null-session stub renders the
// exact logged-out view a crawler should index.
const PRERENDER_AUTH = {
  session: null,
  user: null,
  loading: false,
  emailVerified: false,
} as unknown as AuthState;

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

// ── Marketing-page prerendering ─────────────────────────────────────────────
// Renders fully-static, SSR-safe marketing pages to HTML at build time so
// non-JS crawlers (GPTBot / ClaudeBot / PerplexityBot, plus Google's raw
// fetch) get real content instead of an empty <div id="root">. Pages that
// fetch data at runtime (Atlas / Library / Validation) are intentionally
// excluded — they'd only prerender a loading shell.

interface MarketingMeta {
  title: string;
  description: string;
  canonical: string;
  jsonLd?: string[];
}

function renderMarketing(
  location: string,
  node: React.ReactElement,
  meta: MarketingMeta,
): Rendered {
  const html = renderToStaticMarkup(
    <StaticRouter location={location}>
      <AuthCtx.Provider value={PRERENDER_AUTH}>{node}</AuthCtx.Provider>
    </StaticRouter>,
  );
  return {
    html,
    title: meta.title,
    description: meta.description,
    canonical: meta.canonical,
    jsonLd: meta.jsonLd ?? [],
  };
}

export interface MarketingRoute {
  /** Output directory under dist/ ("" = dist/index.html, the site root). */
  dir: string;
  render: () => Rendered;
}

const HOME_DESCRIPTION =
  "Free, mutation-aware molecular docking in your browser. Dock small " +
  "molecules against wild-type and mutant protein pockets, rank by " +
  "selectivity, and get pose validation plus ADMET — no install. Powered by " +
  "AutoDock Vina / QuickVina2 and Boltz-2.";

export const marketingRoutes: MarketingRoute[] = [
  {
    dir: "",
    render: () =>
      renderMarketing("/", <HomePage />, {
        title:
          "Liganx — Free molecular docking online · Vina + Boltz-2 · Mutation-aware",
        description: HOME_DESCRIPTION,
        canonical: `${SITE}/`,
        // Home JSON-LD already ships in index.html — don't duplicate it.
        jsonLd: [],
      }),
  },
  {
    dir: "about",
    render: () =>
      renderMarketing("/about", <AboutPage />, {
        title: "About Liganx — the team behind the docking platform",
        description:
          "Who builds Liganx: a team working on mutation-aware molecular " +
          "docking and structure-based drug discovery, and how our blog " +
          "content is researched and reviewed.",
        canonical: `${SITE}/about`,
      }),
  },
  {
    dir: "mutation-docking-guide",
    render: () =>
      renderMarketing("/mutation-docking-guide", <MutationDockingGuidePage />, {
        title:
          "How to dock against a kinase mutation — practical guide · Liganx",
        description:
          "Plain-English guide to molecular docking against clinically " +
          "relevant kinase mutations: EGFR T790M, BCR-ABL T315I, BRAF V600E, " +
          "KRAS G12C. Which PDB to use, how to read Δ scores, common pitfalls.",
        canonical: `${SITE}/mutation-docking-guide`,
      }),
  },
  {
    dir: "privacy",
    render: () =>
      renderMarketing("/privacy", <PrivacyPage />, {
        title: "Privacy Policy · Liganx",
        description:
          "How Liganx handles your account, structures, SMILES, and docking " +
          "job data. Plain-English research-preview privacy policy.",
        canonical: `${SITE}/privacy`,
      }),
  },
  {
    dir: "terms",
    render: () =>
      renderMarketing("/terms", <TermsPage />, {
        title: "Terms of Service · Liganx",
        description:
          "Terms of service for Liganx — research-preview free molecular " +
          "docking. What we offer, what we don't promise, and how docking " +
          "scores should be interpreted.",
        canonical: `${SITE}/terms`,
      }),
  },
];
