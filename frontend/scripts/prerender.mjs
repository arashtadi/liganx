/**
 * Build-time prerender for the blog routes.
 *
 * Runs AFTER `vite build` (see package.json "build"). It boots Vite's SSR
 * pipeline, renders /blog and every /blog/:slug to static HTML via
 * src/prerender/entry.tsx, and writes dist/blog/index.html +
 * dist/blog/<slug>/index.html. Vercel serves those static files for the
 * matching clean URLs (filesystem is checked before the SPA rewrite), so
 * crawlers and social scrapers get real content + per-post metadata without
 * running JavaScript. The live SPA still takes over on load (createRoot
 * replaces #root), so this is pure progressive enhancement.
 *
 * SAFETY: this step is intentionally NON-FATAL. If anything throws, we log a
 * warning and exit 0 so `npm run build` still succeeds and the SPA deploys
 * normally. A prerender bug can never break the production build or take the
 * site down — worst case the blog falls back to client-side rendering, which
 * is exactly today's behavior.
 */

import { createServer } from "vite";
import fs from "node:fs";
import path from "node:path";

// Defaults to ./dist (the Vite build output). PRERENDER_DIST lets a test
// harness point it at an alternate build directory without touching prod.
const DIST = path.resolve(process.cwd(), process.env.PRERENDER_DIST || "dist");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function applyHead(template, r) {
  let html = template;
  const t = escapeHtml(r.title);
  const d = escapeAttr(r.description);
  const c = escapeAttr(r.canonical);

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`);
  html = html.replace(
    /<meta name="description"[^>]*>/,
    `<meta name="description" content="${d}" />`,
  );
  html = html.replace(
    /<link rel="canonical"[^>]*>/,
    `<link rel="canonical" href="${c}" />`,
  );
  html = html.replace(
    /<meta property="og:title"[^>]*>/,
    `<meta property="og:title" content="${escapeAttr(r.title)}" />`,
  );
  html = html.replace(
    /<meta property="og:description"[^>]*>/,
    `<meta property="og:description" content="${d}" />`,
  );
  html = html.replace(
    /<meta property="og:url"[^>]*>/,
    `<meta property="og:url" content="${c}" />`,
  );
  html = html.replace(
    /<meta name="twitter:title"[^>]*>/,
    `<meta name="twitter:title" content="${escapeAttr(r.title)}" />`,
  );
  html = html.replace(
    /<meta name="twitter:description"[^>]*>/,
    `<meta name="twitter:description" content="${d}" />`,
  );

  const ld = (r.jsonLd || [])
    .map((j) => `<script type="application/ld+json">${j}</script>`)
    .join("\n    ");
  if (ld) html = html.replace("</head>", `    ${ld}\n  </head>`);

  html = html.replace(
    /<div id="root"><\/div>/,
    `<div id="root">${r.html}</div>`,
  );
  return html;
}

function writePage(routeDir, finalHtml) {
  const dir = path.join(DIST, routeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), finalHtml, "utf8");
}

async function main() {
  const templatePath = path.join(DIST, "index.html");
  if (!fs.existsSync(templatePath)) {
    console.warn("[prerender] dist/index.html not found — skipping prerender.");
    return;
  }
  const template = fs.readFileSync(templatePath, "utf8");

  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });

  try {
    const entry = await vite.ssrLoadModule("/src/prerender/entry.tsx");

    // /blog index
    const idx = entry.renderIndex();
    writePage("blog", applyHead(template, idx));

    // each post
    let count = 0;
    for (const slug of entry.slugs) {
      const r = entry.renderPost(slug);
      if (!r) continue;
      writePage(path.join("blog", slug), applyHead(template, r));
      count++;
    }
    console.log(`[prerender] wrote /blog + ${count} post pages to dist/blog/`);
  } finally {
    await vite.close();
  }
}

main().catch((err) => {
  console.warn(
    "[prerender] non-fatal: prerender failed, SPA fallback still deployed.\n",
    err?.stack || err,
  );
  process.exit(0);
});
