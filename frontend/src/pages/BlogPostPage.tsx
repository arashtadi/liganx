/**
 * BlogPostPage — single blog post.
 *
 * Reads the slug from the URL, looks up the post in the registry,
 * renders its component inside an article wrapper, and emits per-post
 * SEO machinery:
 *
 *   - usePageMeta sets <title>, description, canonical, OG/Twitter tags
 *   - useJsonLd injects an Article schema with datePublished + author
 *     so Google can show date + author in the SERP snippet
 *   - <article> with a real <header> + <h1> gives the right semantic
 *     skeleton for "Top Stories" rich-result eligibility
 *   - Breadcrumb JSON-LD points back to /blog so Google can show the
 *     breadcrumb trail in search results
 *
 * Unknown slug → 404 page (the same NotFound component App.tsx uses).
 */

import { Link, useParams } from "react-router-dom";
import { getPost } from "../blog/registry";
import { usePageMeta } from "../lib/usePageMeta";
import { useJsonLd } from "../lib/useJsonLd";

const SITE = "https://liganx.com";

export default function BlogPostPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const post = getPost(slug);

  // Hooks must run in stable order — call them with safe defaults
  // for the not-found case so React doesn't complain. The not-found
  // branch returns below.
  const meta = post?.meta;
  const url = `${SITE}/blog/${slug}`;
  usePageMeta({
    title: meta ? `${meta.title} · Liganx blog` : "Post not found · Liganx blog",
    description: meta?.description ?? "This post does not exist.",
    canonical: url,
    ogImage: meta?.hero ? (meta.hero.startsWith("http") ? meta.hero : `${SITE}${meta.hero}`) : undefined,
  });

  useJsonLd(
    `blog-post-${slug || "missing"}`,
    meta
      ? {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: meta.title,
          description: meta.description,
          url,
          datePublished: meta.date,
          ...(meta.updated ? { dateModified: meta.updated } : { dateModified: meta.date }),
          ...(meta.author
            ? { author: { "@type": "Person", name: meta.author } }
            : {}),
          publisher: {
            "@type": "Organization",
            name: "Liganx",
            url: SITE,
          },
          mainEntityOfPage: { "@type": "WebPage", "@id": url },
          ...(meta.hero
            ? { image: meta.hero.startsWith("http") ? meta.hero : `${SITE}${meta.hero}` }
            : { image: `${SITE}/og-image.png` }),
          ...(meta.tags && meta.tags.length > 0 ? { keywords: meta.tags.join(", ") } : {}),
        }
      : null,
  );

  // Breadcrumb schema lives in its own JSON-LD block so the cleanup
  // hook removes only this one when slug changes.
  useJsonLd(
    `blog-post-breadcrumb-${slug || "missing"}`,
    meta
      ? {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE },
            { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog` },
            { "@type": "ListItem", position: 3, name: meta.title, item: url },
          ],
        }
      : null,
  );

  if (!post || !meta) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 text-center">
        <h1 className="text-2xl font-bold text-ink dark:text-white">
          Post not found
        </h1>
        <p className="muted mt-2">
          The post you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
        </p>
        <div className="mt-6">
          <Link to="/blog" className="btn-primary btn-sm">
            Back to blog
          </Link>
        </div>
      </div>
    );
  }

  const { Component } = post;

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
          into index.css's .prose-blog class (added below) so post
          components don't have to wrestle individual paragraph styles. */}
      <div className="prose-blog text-slate-700 dark:text-slate-300">
        <Component />
      </div>

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
