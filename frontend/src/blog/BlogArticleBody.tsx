/**
 * BlogArticleBody — the visible article markup for a single post.
 *
 * Extracted out of BlogPostPage so the SAME markup can be rendered two ways:
 *   1. At runtime by BlogPostPage (client-side SPA route).
 *   2. At build time by the prerender script (scripts/prerender.mjs), which
 *      renders this to static HTML so crawlers and social scrapers see real
 *      content + internal links without executing JavaScript.
 *
 * Because it's prerendered in a plain Node environment, this component MUST
 * stay window-safe: only JSX + react-router <Link>, no document/window access,
 * no hooks that touch the DOM. The SEO side-effects (title, meta, JSON-LD)
 * live in BlogPostPage (runtime) and the prerender script (build time), not
 * here.
 *
 * It renders:
 *   - breadcrumb back-link
 *   - header (date · reading time · author byline) + h1 + description lede
 *   - the post body component
 *   - a "Related posts" block (automatic internal linking via shared tags)
 *   - an author/expertise note linking to /about (E-E-A-T for YMYL content)
 *   - tag chips + back-to-blog link
 */

import { Link } from "react-router-dom";
import type { LoadedPost } from "./registry";
import { relatedPosts } from "./registry";

export default function BlogArticleBody({ post }: { post: LoadedPost }) {
  const { meta, Component } = post;
  const related = relatedPosts(meta.slug, 3);

  return (
    <article className="max-w-3xl mx-auto py-8 px-4 sm:px-6">
      {/* Breadcrumb — visible AND in JSON-LD for crawler clarity. */}
      <nav
        aria-label="Breadcrumb"
        className="mb-6 text-[11px] font-mono uppercase tracking-wider text-slate-500"
      >
        <Link to="/blog" className="hover:text-cyan-600 dark:hover:text-cyan-400">
          ← Blog
        </Link>
      </nav>

      <header className="mb-8 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-500 mb-3">
          <time dateTime={meta.date}>
            {new Date(meta.date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </time>
          {meta.readingMin && (
            <>
              <span aria-hidden>·</span>
              <span>{meta.readingMin} min read</span>
            </>
          )}
          {meta.author && (
            <>
              <span aria-hidden>·</span>
              <span>{meta.author}</span>
            </>
          )}
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink dark:text-white">
          {meta.title}
        </h1>
        <p className="mt-3 text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
          {meta.description}
        </p>
      </header>

      {/* Prose body — relies on Tailwind typography-ish utilities baked
          into index.css's .prose-blog class so post components don't have
          to wrestle individual paragraph styles. */}
      <div className="prose-blog text-slate-700 dark:text-slate-300">
        <Component />
      </div>

      {/* Related posts — automatic internal linking. Every post links out
          to 3 topically-adjacent posts (shared tags), which spreads crawl
          equity across the catalogue and keeps readers on-site. */}
      {related.length > 0 && (
        <aside
          aria-label="Related posts"
          className="mt-12 pt-6 border-t border-slate-200 dark:border-slate-800"
        >
          <h2 className="text-[11px] font-mono uppercase tracking-[0.15em] text-slate-500 mb-4">
            Related posts
          </h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {related.map((r) => (
              <li key={r.meta.slug}>
                <Link
                  to={`/blog/${r.meta.slug}`}
                  className="block h-full rounded-lg border border-slate-200 dark:border-slate-800 p-4 hover:border-cyan-400 dark:hover:border-cyan-500/60 transition-colors"
                >
                  <span className="block text-sm font-semibold text-ink dark:text-white leading-snug">
                    {r.meta.title}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400 line-clamp-3">
                    {r.meta.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <footer className="mt-12 pt-6 border-t border-slate-200 dark:border-slate-800">
        {meta.tags && meta.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4 text-[11px] font-mono uppercase tracking-wider">
            <span className="text-slate-500">Tags</span>
            {meta.tags.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Author / expertise note — E-E-A-T signal for medically-adjacent
            content. Links to /about where the team's drug-discovery and
            computational-chemistry background is described. */}
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Written by the{" "}
          <Link
            to="/about"
            className="text-cyan-600 dark:text-cyan-400 hover:underline"
          >
            Liganx team
          </Link>
          {" "}— a group working on mutation-aware molecular docking and
          structure-based drug discovery. Posts are reviewed against primary
          literature; sources are cited at the foot of each article.
        </p>

        <Link
          to="/blog"
          className="text-cyan-600 dark:text-cyan-400 hover:underline text-sm font-medium"
        >
          ← Back to all posts
        </Link>
      </footer>
    </article>
  );
}
