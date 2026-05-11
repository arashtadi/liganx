/**
 * BlogIndexPage — chronological listing of all published blog posts.
 *
 * SEO design notes:
 *   - <h1> is "Liganx blog" so Google understands what the index is for.
 *   - Each post card uses a real semantic <article> with <h2>, <time>,
 *     and a <p> excerpt — gives Google the structure for sitelinks /
 *     "Top Stories"-style enrichment without needing CollectionPage
 *     JSON-LD (we add that anyway).
 *   - Internal links are <Link>, not <a>, so the SPA router handles
 *     the navigation and the user doesn't pay a full-page reload.
 *   - usePageMeta sets the title + description + canonical so the
 *     index page has its own SERP snippet distinct from the homepage.
 *
 * The page deliberately doesn't paginate — at three posts there's
 * nothing to paginate. When we hit ~30 posts we'll add tag-faceted
 * browsing and then pagination.
 */

import { Link } from "react-router-dom";
import { posts } from "../blog/registry";
import { usePageMeta } from "../lib/usePageMeta";
import { useJsonLd } from "../lib/useJsonLd";

const SITE = "https://liganx.com";

export default function BlogIndexPage() {
  usePageMeta({
    title: "Blog · Liganx — molecular docking, mutations, and drug design",
    description:
      "Field notes on docking workflows, mutation-aware drug design, ADMET liabilities, and what's actually moving in oncology medicinal chemistry.",
    canonical: `${SITE}/blog`,
  });

  // CollectionPage / Blog schema. Helps Google treat the URL as the
  // root of a publication and connect the post-level Article schemas.
  useJsonLd("blog-index", {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Liganx Blog",
    description:
      "Field notes on docking workflows, mutation-aware drug design, ADMET liabilities, and oncology medicinal chemistry.",
    url: `${SITE}/blog`,
    publisher: {
      "@type": "Organization",
      name: "Liganx",
      url: SITE,
    },
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.meta.title,
      url: `${SITE}/blog/${p.meta.slug}`,
      datePublished: p.meta.date,
      ...(p.meta.author ? { author: { "@type": "Person", name: p.meta.author } } : {}),
    })),
  });

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6">
      <header className="mb-10 border-b border-slate-200 dark:border-slate-800 pb-6">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink dark:text-white">
          Blog
        </h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400 text-base">
          Field notes on docking workflows, mutation-aware drug design,
          ADMET liabilities, and what&rsquo;s actually moving in oncology
          medicinal chemistry.
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="muted">No posts yet. Check back soon.</p>
      ) : (
        <div className="space-y-8">
          {posts.map(({ meta }) => (
            <article
              key={meta.slug}
              className="group border-b border-slate-200 dark:border-slate-800/60 pb-8 last:border-b-0"
            >
              <div className="flex items-center gap-3 text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-500 mb-2">
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
                {meta.tags && meta.tags.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="text-cyan-600 dark:text-cyan-400">
                      {meta.tags.slice(0, 3).join(" · ")}
                    </span>
                  </>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold text-ink dark:text-white group-hover:text-cyan-700 dark:group-hover:text-cyan-300 transition-colors">
                <Link to={`/blog/${meta.slug}`} className="no-underline">
                  {meta.title}
                </Link>
              </h2>
              <p className="mt-2 text-slate-600 dark:text-slate-400 text-base leading-relaxed">
                {meta.description}
              </p>
              <div className="mt-3">
                <Link
                  to={`/blog/${meta.slug}`}
                  className="text-cyan-600 dark:text-cyan-400 hover:underline text-sm font-medium"
                >
                  Read more →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
