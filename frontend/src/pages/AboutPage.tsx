/**
 * AboutPage — /about
 *
 * Exists primarily as an E-E-A-T anchor. The blog covers medically-adjacent
 * topics (cancer-driver mutations, kinase inhibitors, ADMET/tox), which
 * Google treats as YMYL ("Your Money or Your Life") content and weights
 * heavily on demonstrable expertise, authoritativeness, and trust. A real
 * About page that describes who is behind the content — and that every blog
 * post links to as its author — is the standard, white-hat way to supply
 * that signal. It's also linked from the footer on every page.
 */

import { Link } from "react-router-dom";
import { usePageMeta } from "../lib/usePageMeta";
import { useJsonLd } from "../lib/useJsonLd";

const SITE = "https://liganx.com";

export default function AboutPage() {
  usePageMeta({
    title: "About Liganx — the team behind the docking platform",
    description:
      "Who builds Liganx: a team working on mutation-aware molecular docking and structure-based drug discovery, and how our blog content is researched and reviewed.",
    canonical: `${SITE}/about`,
  });

  useJsonLd("about-organization", {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Liganx",
    url: SITE,
    description:
      "Liganx is a free, browser-based mutation-aware molecular docking platform for structure-based drug discovery.",
    knowsAbout: [
      "molecular docking",
      "structure-based drug design",
      "kinase inhibitors",
      "drug-resistance mutations",
      "ADMET prediction",
    ],
    sameAs: [`${SITE}/blog`],
  });

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 sm:px-6">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink dark:text-white">
        About Liganx
      </h1>
      <p className="mt-4 text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
        Liganx is a free, browser-based platform for mutation-aware molecular
        docking. We built it so that anyone — academic, clinician, or
        med-chemist — can dock compounds against wild-type and mutant protein
        structures side by side, without a local install or a compute cluster.
      </p>

      <div className="prose-blog text-slate-700 dark:text-slate-300 mt-8">
        <h2>Who we are</h2>
        <p>
          The Liganx team works at the intersection of computational chemistry,
          structural biology, and software engineering. Our focus is the
          problem that motivated the platform: clinically important point
          mutations — EGFR T790M, BCR-ABL T315I, KRAS G12C, BRAF V600E and
          dozens more — quietly change how a drug binds, and most docking
          tools make it tedious to compare wild-type against mutant in a
          single, reproducible run. Liganx is built around that comparison.
        </p>

        <h2>What the platform does</h2>
        <p>
          Under the hood, Liganx runs established docking engines — AutoDock
          Vina (GPU-accelerated), GNINA's CNN-rescored poses, and Boltz-2 ML
          co-folding — against curated, prepared receptor structures, and
          layers ADMET property prediction on top. The science is standard;
          the value is in making mutation-aware molecular docking fast,
          free, and accessible in a browser. You can read more on the{" "}
          <Link to="/validation" className="text-cyan-600 dark:text-cyan-400 hover:underline">
            validation page
          </Link>{" "}
          and try it in{" "}
          <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 hover:underline">
            Studio
          </Link>.
        </p>

        <h2>How we write the blog</h2>
        <p>
          Our blog covers drug targets, specific resistance mutations, ADMET
          properties, and docking methodology. Because much of this content is
          medically adjacent, we hold it to a primary-source standard: every
          post cites the peer-reviewed literature, clinical trial readouts, or
          FDA documentation it draws on, in a Primary Sources section at the
          foot of the article. We describe what the evidence shows and avoid
          inventing drug names, mutation effects, or trial results. Nothing on
          the blog is medical advice — it is technical material written for
          researchers who already work in drug discovery.
        </p>

        <h2>Get in touch</h2>
        <p>
          Questions, corrections, or collaboration ideas are welcome — reach us
          via the{" "}
          <Link to="/contact" className="text-cyan-600 dark:text-cyan-400 hover:underline">
            contact page
          </Link>
          . If you spot an error in a post, tell us and we will fix and
          re-date it.
        </p>
      </div>

      <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-wrap gap-4 text-sm">
        <Link to="/blog" className="text-cyan-600 dark:text-cyan-400 hover:underline font-medium">
          Read the blog →
        </Link>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 hover:underline font-medium">
          Open Studio →
        </Link>
      </div>
    </div>
  );
}
