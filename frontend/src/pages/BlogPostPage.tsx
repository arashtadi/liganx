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
import BlogArticleBody from "../blog/BlogArticleBody";
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
          // "Liganx team" is a group, not a named individual, so the
          // author is modeled as an Organization (schema-valid) rather than
          // a Person. The /about page backs this with the team's expertise
          // (E-E-A-T) and is referenced as the author URL.
          ...(meta.author
            ? {
                author: {
                  "@type": "Organization",
                  name: meta.author,
                  url: `${SITE}/about`,
                },
              }
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

  // The visible article markup lives in BlogArticleBody so the prerender
  // script can render the identical HTML at build time (see
  // scripts/prerender.mjs). This page wraps it with the runtime SEO
  // side-effects (usePageMeta + useJsonLd above) and not-found handling.
  return <BlogArticleBody post={post} />;
}
