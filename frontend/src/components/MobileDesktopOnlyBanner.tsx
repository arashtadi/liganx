import { Link } from "react-router-dom";

/**
 * Mobile-blocking banner for desktop-heavy pages (Studio, JobPage).
 *
 * Studio runs a 3-pane control center: Ketcher 2D sketcher (mouse-drag
 * heavy), 3Dmol pose viewer (camera rotation, residue picking, distance
 * measure mode), and a grid-cols-12 setup rail with multi-target /
 * multi-mutation typeaheads. None of these collapse to phone usefully —
 * trying to expose Studio to a phone visitor produces a broken UI that
 * looks like a bug rather than an intentional design choice.
 *
 * JobPage is similar: 2D contact map + 3Dmol viewer + selectivity matrix
 * + ADMET panels in a desktop-first layout.
 *
 * Rather than half-collapsing into something miserable, we render this
 * banner above the page on phones (<md ≈ 768px). Visitors see it
 * immediately, get pointed to the public pages that DO work on a phone
 * (Atlas, Library, Validation, Blog), and can still continue to the
 * desktop UI if they insist — the page renders below the banner so this
 * isn't a hard block. We don't want to fully gate the page (deep links
 * from email digests, tablet users in landscape, etc.).
 *
 * `md:hidden` + a top margin ensures the banner only shows below 768px
 * and never displaces the desktop layout.
 */
export default function MobileDesktopOnlyBanner({ pageName }: { pageName: string }) {
  return (
    <div className="md:hidden bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 px-4 py-3 text-[12px] text-amber-900 dark:text-amber-200">
      <div className="font-semibold mb-1">{pageName} is designed for desktop.</div>
      <div className="text-amber-800/90 dark:text-amber-200/80 leading-relaxed">
        The 2D sketcher and 3D pose viewer need a wider screen and a mouse.
        On phone, try these pages instead — they're fully mobile-friendly:
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          to="/atlas"
          className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 hover:bg-amber-200 dark:hover:bg-amber-800/60"
        >
          Resistance Atlas
        </Link>
        <Link
          to="/library"
          className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 hover:bg-amber-200 dark:hover:bg-amber-800/60"
        >
          Pre-computed library
        </Link>
        <Link
          to="/validation"
          className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 hover:bg-amber-200 dark:hover:bg-amber-800/60"
        >
          Validation
        </Link>
        <Link
          to="/blog"
          className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 hover:bg-amber-200 dark:hover:bg-amber-800/60"
        >
          Blog
        </Link>
      </div>
    </div>
  );
}
