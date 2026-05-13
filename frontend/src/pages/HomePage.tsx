import { Link } from "react-router-dom";
import {
  ArrowRight, Beaker, Bolt, Eye, Grid, Library, Shield, Sparkles, Target,
} from "../components/Icons";
import { useAuth } from "../lib/auth";

/**
 * Marketing landing page. Renders as a stack of FULL-BLEED section bands
 * (Schrödinger / Stripe / Vercel pattern): each <section> spans 100% of
 * the viewport for its background, while a child <Container> centers the
 * actual content at max-w-6xl. App.tsx detects "/" and drops the outer
 * max-w-6xl wrapper so this page can paint edge to edge — internal
 * pages (NewJob, History, Job, Settings) keep their constrained column
 * because they're dense data UIs that read worse stretched.
 *
 * Bands alternate background tone (white → slate-50 → white …) so the
 * page has visual rhythm without needing dividers.
 */
export default function HomePage() {
  return (
    <div className="flex flex-col">
      <Hero />
      <LogoStrip />
      <HowItWorks />
      <WhatsNew />
      <FeatureGrid />
      <Comparison />
      <CTAStrip />
    </div>
  );
}

/**
 * Section content centerer. Pair with a full-width <section> that owns
 * the background; this just constrains the inner content + adds the
 * standard horizontal padding so it never touches the viewport edge on
 * mobile.
 */
function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>
  );
}

/* ─── Hero ──────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-white dark:bg-slate-950 border-b border-slate-200/80 dark:border-slate-800">
      {/* Background flourishes — full-bleed so the gradient blobs read as
          atmospheric color across the whole viewport, not just inside a
          centered card. Anchored to viewport corners with negative offsets
          so they bleed past the edge on big monitors. */}
      <div className="pointer-events-none absolute inset-0 bg-hero-grid" />
      <div className="pointer-events-none absolute -top-32 -right-32 w-[40rem] h-[40rem] rounded-full bg-delta-100/60 blur-3xl dark:bg-delta-700/30" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 w-[40rem] h-[40rem] rounded-full bg-accent-400/20 blur-3xl dark:bg-accent-500/20" />

      {/* Mobile-first hero padding: tightened from py-16 to py-10 on the
          smallest viewport so the matrix-preview card sits closer to the
          fold on phones. sm+ keeps the airier desktop spacing. */}
      <Container className="relative py-10 sm:py-20 lg:py-28">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3 flex flex-col justify-center">
            <div className="eyebrow flex items-center gap-2">
              <Sparkles size={14} /> Mutation-aware docking
            </div>
            <h1 className="mt-4 text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-ink dark:text-white leading-[1.1] sm:leading-[1.05]">
              Find compounds that
              <br />
              <span className="bg-gradient-to-r from-delta-600 to-accent-500 bg-clip-text text-transparent dark:from-delta-400 dark:to-accent-400">
                prefer the mutant.
              </span>
            </h1>
            <p className="mt-5 sm:mt-6 text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-xl leading-relaxed">
              Pick a clinically relevant mutation. Pick your compounds. We dock against
              wild-type <em>and</em> mutant in parallel and show exactly which compounds
              gain selectivity — no PyMOL, FoldX, or AutoDock setup. Or skip setup
              entirely and browse our pre-computed FDA-drug screenings against every
              catalog mutation.
            </p>
            <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
              <Link to="/studio" className="btn-primary btn-lg justify-center">
                Start a docking run <ArrowRight size={16} />
              </Link>
              <Link to="/library" className="btn-secondary btn-lg justify-center">
                Browse pre-computed screenings
              </Link>
            </div>
            {/* First-time-visitor escape hatch: land in Studio with a
                working selectivity example pre-staged. Cheaper first
                impression than the empty form — one click to see what
                a real result looks like. */}
            <div className="mt-3 text-[12px] text-slate-500 dark:text-slate-400">
              First time?{" "}
              <Link to="/studio?demo=braf-v600e" className="text-delta-700 dark:text-delta-300 font-semibold hover:underline">
                Open a worked example: BRAF V600E + Vemurafenib →
              </Link>
            </div>
            <div className="mt-6 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
              <span className="flex items-center gap-1.5"><Check /> No install</span>
              <span className="flex items-center gap-1.5"><Check /> Vina + GNINA + Boltz-2 ML</span>
              <span className="flex items-center gap-1.5"><Check /> Mutation-aware virtual screening</span>
              <span className="flex items-center gap-1.5"><Check /> Resistance Atlas + calibrate your own data</span>
              <span className="flex items-center gap-1.5"><Check /> Ask the AI about your job</span>
              <span className="flex items-center gap-1.5"><Check /> Free for academic use</span>
            </div>
          </div>

          <div className="lg:col-span-2 flex items-center justify-center">
            <MatrixPreview />
          </div>
        </div>
      </Container>
    </section>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#10b981" opacity="0.15" />
      <path d="M7 12l3 3 7-7" stroke="#10b981" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mini static selectivity matrix used in the hero — pure decoration, real numbers. */
function MatrixPreview() {
  type Row = { name: string; wt: number; t790m: number; c797s: number };
  const rows: Row[] = [
    { name: "Osimertinib", wt: -8.8, t790m: -9.3, c797s: -5.2 },
    { name: "Gefitinib",   wt: -7.2, t790m: -5.1, c797s: -4.9 },
    { name: "Erlotinib",   wt: -7.6, t790m: -5.4, c797s: -5.3 },
    { name: "Compound X",  wt: -6.1, t790m: -7.8, c797s: -7.1 },
  ];

  function cellColor(score: number, wt: number) {
    const d = score - wt;
    if (d < -0.4) return `rgba(16, 185, 129, ${Math.min(0.5, 0.15 + Math.abs(d) * 0.15)})`;
    if (d > 0.4)  return `rgba(239, 68, 68, ${Math.min(0.5, 0.15 + Math.abs(d) * 0.15)})`;
    return "transparent";
  }

  return (
    <div className="w-full max-w-md panel p-5 ring-1 ring-slate-100 dark:ring-slate-800">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Sample
          </div>
          <div className="text-sm font-semibold text-ink dark:text-slate-100">EGFR · selectivity matrix</div>
        </div>
        <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40">
          example
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 dark:text-slate-400">
            <th className="text-left font-medium pb-2">Compound</th>
            <th className="text-right font-medium pb-2">WT</th>
            <th className="text-right font-medium pb-2">T790M</th>
            <th className="text-right font-medium pb-2">C797S</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-2 pr-2 font-sans font-medium text-ink dark:text-slate-100">{r.name}</td>
              <td className="py-2 pr-2 text-right text-slate-700 dark:text-slate-300">{r.wt.toFixed(1)}</td>
              <td className="py-2 pr-2 text-right text-slate-700 dark:text-slate-300" style={{ background: cellColor(r.t790m, r.wt) }}>
                {r.t790m.toFixed(1)}
              </td>
              <td className="py-2 text-right text-slate-700 dark:text-slate-300" style={{ background: cellColor(r.c797s, r.wt) }}>
                {r.c797s.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1.5">
        <div>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Compound X</span> is predicted to bind
          the <strong className="dark:text-slate-200">T790M mutant</strong> 1.7 kcal/mol better than wild-type — a candidate
          for resistance.
        </div>
        {/* Honesty note added 2026-04-30 after a medicinal-chemistry audit:
            Vina/QuickVina2 has a documented score noise floor of roughly
            ±1 kcal/mol at default exhaustiveness. A 1.7 kcal/mol Δ is real
            signal but not enormous — flagging this near the headline
            example keeps the marketing aligned with what the method can
            actually resolve. The full job UI flags Δ < 1 kcal/mol as
            within-noise. */}
        <div className="text-[10px] text-slate-400 dark:text-slate-500 italic">
          Vina scoring noise is roughly ±1 kcal/mol at default exhaustiveness — Δs above ~1 kcal/mol are interpretable, smaller deltas live near the noise floor.
        </div>
      </div>
    </div>
  );
}

/* ─── Logo strip ────────────────────────────────────────────────────── */

function LogoStrip() {
  return (
    <section className="bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200/80 dark:border-slate-800/60">
      <Container className="py-10 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 font-semibold">
          Built on tools the community already trusts
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-slate-400 dark:text-slate-500">
          <Pill>AutoDock Vina</Pill>
          <Pill>RDKit</Pill>
          <Pill>FoldX</Pill>
          <Pill>Mol*</Pill>
          <Pill>ProLIF</Pill>
          <Pill>RunPod</Pill>
        </div>
      </Container>
    </section>
  );
}
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-sm font-medium tracking-wide text-slate-500 dark:text-slate-400">{children}</span>
  );
}

/* ─── How it works ──────────────────────────────────────────────────── */

function HowItWorks() {
  const steps = [
    {
      n: 1,
      icon: <Target />,
      title: "Pick a target",
      body: "Choose from clinically actionable kinases or upload your own PDB. Pocket boxes are pre-defined.",
    },
    {
      n: 2,
      icon: <Beaker />,
      title: "Pick mutations",
      body: "Click EGFR T790M, KRAS G12C, BRAF V600E — anything from the curated library, or type your own.",
    },
    {
      n: 3,
      icon: <Grid />,
      title: "Read the matrix",
      body: "We dock every compound against WT and each mutant. The Δ-score shows you which compounds prefer which.",
    },
  ];
  return (
    <section className="bg-white dark:bg-slate-950">
      <Container className="py-12 sm:py-20">
        <SectionHead eyebrow="How it works" title="From mutation to selectivity matrix in three clicks." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {steps.map((s) => (
            <div key={s.n} className="card relative">
              <div className="absolute top-4 right-4 text-7xl font-black text-slate-100 dark:text-slate-800 select-none leading-none">
                {s.n}
              </div>
              <div className="relative">
                <div className="w-10 h-10 rounded-lg bg-delta-50 text-delta-600 dark:bg-delta-900/40 dark:text-delta-300 flex items-center justify-center mb-3">
                  {s.icon}
                </div>
                <h3 className="font-semibold text-ink dark:text-slate-100 mb-1.5">{s.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ─── Feature grid ──────────────────────────────────────────────────── */

function FeatureGrid() {
  const features: { icon: React.ReactNode; title: string; body: string; isNew?: boolean }[] = [
    {
      icon: <Grid />,
      title: "Selectivity matrix",
      body: "N compounds × M mutants in one view. Cells colored by Δ-score so resistance and selectivity gain pop out instantly.",
    },
    {
      // v1.23 P1.x — the screening engine + pre-computed library snapshots.
      // Lead with this because it's the wedge buyers care about: a free
      // public surface that no other free tool ships and that paid tools
      // make you assemble yourself.
      icon: <Library />,
      title: "Pre-computed library screenings",
      body: "30 FDA-launched oncology kinase inhibitors pre-docked against every catalog resistance mutation (KRAS G12C/G12D/Q61H, EGFR T790M/L858R/C797S, BCR-ABL T315I/E255K, …). Public landing pages, no login. Click any card on /library to see the ranked selectivity hits in 1 second.",
      isNew: true,
    },
    {
      // v1.20-v1.21.1 — the mutation-aware VS engine + promote flow.
      icon: <Bolt />,
      title: "Mutation-aware virtual screening",
      body: "Pick a target + mutation, drop in up to 1000 compounds, get a ranked hit list scored by selectivity_index (|mutant| × sigmoid(−Δ × 4)). WT and mutant docked in parallel. Tick the top hits, promote to Full Job, land instantly on the deep view — no re-dock thanks to pose cloning.",
      isNew: true,
    },
    {
      // v1.13 — Liganx AI Beta. A scoped Q&A on a job's results that
      // companies will care about because it makes a 90-row matrix
      // legible to a non-computational chemist.
      icon: <Sparkles />,
      title: "Liganx AI Beta — ask your results",
      body: "Pose viewer too dense? Ask the panel. \"Which compounds beat WT for Q61H?\" \"Why does Δ matter here?\" \"Is the C797S row trustworthy?\" Claude Haiku with the full job snapshot as context — per-user chat history that persists across sessions so you can pick up tomorrow.",
      isNew: true,
    },
    {
      // Resistance Atlas + Calibrate-your-own-data. The Atlas is the
      // public-facing surface; the calibrate flow lets a user score their
      // own (drug, mutation) cases against the same 2-signal model. Now
      // backed by real ESM-2 inference on the GPU pod for novel mutations
      // — previously fell back to a BLOSUM62 proxy.
      icon: <Target />,
      title: "Resistance Atlas + Calibrate-your-own-data",
      body: "Public per-drug atlas ranking the most likely emergent clinical-resistance mutations (15 drugs covered, ROC-AUC 0.81 cross-validated on 50 events). Upload your own (drug, mutation) CSV at /atlas/calibrate to score against the same model — novel (gene, position, mutant) tuples get real ESM-2 fitness from our GPU pod, not a substitution-matrix proxy.",
      isNew: true,
    },
    {
      // v1.00 — ADMET-extended already exists, but the homepage cards
      // talked about "Drug-likeness panel" generically. Make the
      // explicit hERG/DILI/CYP/BBB list visible because those four
      // are exactly what a med-chemist filters on first.
      icon: <Shield />,
      title: "Inline ADMET safety panel",
      body: "Every compound shows hERG, BBB penetration, DILI risk, CYP3A4 + CYP2D6 inhibition via admet-ai (Therapeutic Data Commons models, deployed on the same pod as the docker). Color-coded chip set — flag the liver-toxic compound at a glance before promoting it.",
      isNew: true,
    },
    {
      icon: <Bolt />,
      title: "GPU-accelerated docking",
      body: "QuickVina2-GPU on a dedicated RunPod NVIDIA Blackwell GPU with batched dispatch — typical cells finish in seconds, not minutes. Real Vina scoring, not a placeholder.",
    },
    {
      icon: <Sparkles />,
      title: "Three scoring engines",
      body: "QuickVina2-GPU (fast Vina-family, default), GNINA (Vina + CNN pose rescoring trained on PDBbind — CNN rescoring requires sm_89 / RTX 4090; on other GPUs GNINA falls back to its Vina-fork score), and Boltz-2 (full ML co-folding from sequence + SMILES — no docking box needed). Three genuinely different methods, side-by-side on the same job. Most free tools give you one.",
      isNew: true,
    },
    // 2026-05-04: added after the Tier 1 AI Optimize loop shipped.
    // Single card describing the whole AI design pipeline so the grid
    // doesn't become 4 separate AI cards. The "Recently shipped" strip
    // above gets the per-feature breakdown.
    {
      icon: <Sparkles />,
      title: "AI medchem co-pilot",
      body: "Optimize button proposes 12 variants tailored to your mutation, GPU-docks all 12 in one batch, returns the 3 with highest composite fitness (Δ-score × synthetic accessibility × mutation contact). Anchors on real literature precedents — Ponatinib, Osimertinib, Pirtobrutinib, Vemurafenib, Sotorasib — instead of inventing chemistry. Quick dock + AI chat live inside the Ketcher sketcher.",
      isNew: true,
    },
    {
      icon: <Library />,
      title: "Your compound library",
      body: "Every named compound auto-saves to your personal library. Pull any saved structure into a new job in one click, organize with color-coded tags (Favorite, Promising, Bad, Send to lab, custom), and edit any structure in Ketcher with save-changes-or-save-as-new. Filter and search across thousands.",
      isNew: true,
    },
    {
      icon: <Eye />,
      title: "Live SMILES validation",
      body: "Inline 2D thumbnail of every compound row updates as you type, powered by server-side RDKit. Catches broken SMILES, disconnected fragments, and 3D-embed failures BEFORE you click Run — with one-click Keep-largest and Fix-in-sketcher repairs. No more 30-second wait then a cryptic 'ligand prep failed'.",
      isNew: true,
    },
    {
      icon: <Bolt />,
      title: "Re-run any job in one click",
      body: "Every History row has a Re-run button that pre-fills the New-job form with the same target, mutations, compounds, engine, and exhaustiveness. Tweak any field — try a different engine, add a mutation, swap a compound — and resubmit without retyping.",
      isNew: true,
    },
    {
      icon: <Sparkles />,
      title: "Plain-English readout",
      body: "Every pose comes with a sentence: which residues drive the interaction, how the mutant differs, whether to trust the Δ.",
    },
    {
      icon: <Beaker />,
      title: "Built-in 2D sketcher",
      body: "Self-hosted EPAM Ketcher, one click from any compound row. Draw a structure, edit it, or paste a SMILES — never leave the page.",
      isNew: true,
    },
    {
      icon: <Eye />,
      title: "Synced 3D viewer",
      body: "Wild-type and mutant side chains overlaid on the same pose, contact-colored by ProLIF interaction type, blend slider to compare.",
    },
    {
      icon: <Shield />,
      title: "Pose validation built in",
      body: "PoseBusters confidence ribbon (clash-free, chirality-correct), Vinardo re-score, and RDKit MMFF strain analysis flags Vina junk poses.",
    },
    {
      icon: <Target />,
      title: "Outside-pocket detection",
      body: "If your mutated residue is farther from the docking-box centre than the box half-edge can sample (typically 11–15 Å, set per target), we tell you up-front and badge the cell instead of letting you read meaning into a noise-level Δ.",
    },
    {
      icon: <Library />,
      title: "Curated mutation library",
      body: "40 clinically actionable mutations across 13 kinase / GTPase / kinase-like targets (EGFR, KRAS, BRAF, IDH1, ABL, HER2, ALK, ROS1, MET, FLT3, BTK, PI3Kα, KIT) — each pocket box is verified to within 5 Å of the chain-A co-crystal ligand centroid by an automated CI gate, with first-line standard-of-care references.",
    },
    {
      icon: <Sparkles />,
      title: "Drug-likeness panel",
      body: "QED, Lipinski Ro5, Veber, PAINS alerts, MW / LogP / TPSA / HBD-HBA / rotatable bonds — every compound, every cell.",
    },
  ];
  return (
    <section className="bg-white dark:bg-slate-950">
      <Container className="py-12 sm:py-20">
        <SectionHead eyebrow="What you get" title="Everything an early-discovery med-chemist actually wants." />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => (
          <div
            key={f.title}
            className="card hover:border-delta-300 hover:shadow-glow dark:hover:border-delta-500 transition-all relative"
          >
            {f.isNew && (
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40">
                New
              </span>
            )}
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-delta-500 to-accent-500 text-white flex items-center justify-center mb-3 shadow-sm">
              {f.icon}
            </div>
            <h3 className="font-semibold text-ink dark:text-slate-100 mb-1.5">{f.title}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{f.body}</p>
          </div>
        ))}
        </div>
      </Container>
    </section>
  );
}

/* ─── What's new ────────────────────────────────────────────────────── */

/**
 * Highlight strip directly under the "How it works" steps. Anchors attention
 * on the latest shipping work so a returning user sees movement and a new
 * visitor reads the project as actively developed. Update this list when
 * shipping anything material — keep to ≤4 items so it stays scannable.
 */
function WhatsNew() {
  // 2026-05-12: 4-card layout after the ESM2-pod deploy. Calibrate-your-own
  // -data went from "BLOSUM proxy demo" to a real Pro-beta feature now that
  // the pod serves live ESM-2 for novel mutations. Atlas card text updated
  // accordingly. v1.20-v1.23 cards (library, VS) still here.
  const items = [
    {
      tag: "Just shipped",
      title: "Resistance Atlas — predict the next mutation that breaks a drug",
      body:
        "For every FDA-approved targeted cancer drug, the Atlas ranks which mutations will most likely emerge as clinical resistance — before patients hit them. Triangulates docking Δ + ESM-2 protein-language-model fitness, calibrated on 50 published clinical-resistance events (ROC-AUC 0.90 in-sample, 0.81 cross-validated). 15 drugs covered today. Novel (gene, position, mutant) lookups now run real ESM-2 on our GPU pod on demand.",
      tone: "delta" as const,
      href: "/atlas",
      cta: "Open the Atlas",
    },
    {
      tag: "Pro beta",
      title: "Calibrate your own (drug, mutation) data against our model",
      body:
        "Upload up to 10 (gene, position, wt, mutant, drug) rows as CSV. We score each through the same 2-signal model the Atlas uses — real ESM-2 inference for novel mutations, instant cache hits for the 49 calibration events — and return joint probability, verdict, and AUC if you provide ground truth. Free tier: 10 rows / day.",
      tone: "violet" as const,
      href: "/atlas/calibrate",
      cta: "Calibrate your data",
    },
    {
      tag: "Just shipped",
      title: "Pre-computed FDA-drug screenings — no setup, no GPU wait",
      body:
        "We pre-ran 30 oncology kinase inhibitors against every resistance mutation in our catalog — KRAS G12C/G12D/Q61H, EGFR T790M/L858R/C797S, BCR-ABL T315I/E255K. Hit a public URL and see ranked selectivity hits in 1 second. Click any compound to see its 3D pose.",
      tone: "accent" as const,
      href: "/library",
      cta: "Browse pre-computed screenings",
    },
    {
      tag: "Just shipped",
      title: "Mutation-aware virtual screening",
      body:
        "Submit 10 compounds against a (target, mutation) pair. We dock each against WT and the mutant in parallel, rank by selectivity index, and return a ranked hit list. Real Vina, real poses, real ADMET. Sieve through a library; pick the top hits.",
      tone: "emerald" as const,
      href: "/studio",
      cta: "Open Studio",
    },
  ];
  return (
    <section className="bg-slate-50 dark:bg-slate-900/40 border-y border-slate-200/80 dark:border-slate-800/60">
      <Container className="py-12 sm:py-20">
        <SectionHead eyebrow="What's new" title="Recently shipped." />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {items.map((it) => (
          <Link
            key={it.title}
            to={it.href}
            className="card relative ring-1 ring-slate-200/70 dark:ring-slate-700/60 overflow-hidden hover:ring-violet-400 dark:hover:ring-violet-500 transition block group"
          >
            <span
              className={
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                (it.tone === "delta"
                  ? "bg-delta-50 text-delta-700 ring-1 ring-inset ring-delta-200 dark:bg-delta-900/30 dark:text-delta-300 dark:ring-delta-700/40"
                  : it.tone === "accent"
                    ? "bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200 dark:bg-accent-900/30 dark:text-accent-300 dark:ring-accent-700/40"
                    : it.tone === "violet"
                      ? "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-700/40"
                      : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40")
              }
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {it.tag}
            </span>
            <h3 className="mt-3 font-semibold text-ink dark:text-slate-100">{it.title}</h3>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{it.body}</p>
            <div className="mt-3 inline-flex items-center text-xs font-semibold text-violet-700 dark:text-violet-300 group-hover:underline">
              {it.cta} <ArrowRight size={12} className="ml-1" />
            </div>
          </Link>
        ))}
        </div>
      </Container>
    </section>
  );
}

/* ─── Comparison ────────────────────────────────────────────────────── */

function Comparison() {
  return (
    <section className="bg-white dark:bg-slate-950">
      <Container className="py-12 sm:py-20">
        <SectionHead eyebrow="Where we sit" title="The missing middle." />
      {/* overflow-x-auto on mobile — at 360px the 4-col table is too wide
          to fit, and `overflow-hidden` would clip the rightmost columns
          (Schrödinger Maestro) silently. `min-w` on the table keeps the
          rows readable instead of squishing into unreadable narrow cells. */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="text-left px-5 py-3 font-semibold text-slate-700 dark:text-slate-300"></th>
              <th className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-300">Free servers</th>
              <th className="px-5 py-3 font-semibold text-delta-700 bg-delta-50 dark:text-delta-300 dark:bg-delta-900/30">Liganx</th>
              {/* Column heading deliberately broadened from "Schrödinger
                  FEP+" to "Schrödinger Maestro" — several rows below
                  describe Maestro / QikProp features (sketcher,
                  drug-likeness, 2D contact map) that aren't part of FEP+
                  specifically, so the narrower label was misleading. */}
              <th className="px-5 py-3 font-semibold text-slate-700 dark:text-slate-300">Schrödinger Maestro</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Mutation-aware",                 false,     true,      true],
              ["WT-vs-mutant matrix",            false,     true,      "partial"],
              // Resistance Atlas — public, per-drug, calibrated forecast of
              // which mutations will most likely break a given drug. No
              // free server ships this; Maestro doesn't ship a public
              // surface (it's a local desktop tool).
              ["Public resistance-mutation atlas", false,    true,      false],
              // Calibrate-your-own-data — upload (drug, mutation) CSV, get
              // joint-probability + verdict scored through the same model
              // the Atlas uses (real ESM-2 inference for novel positions).
              // No comparable external API in free servers or Maestro.
              ["Score your own (drug, mutation) cases", false, true,    false],
              // v1.23 — pre-computed library landing pages. No free server
              // ships these (would require curating + running a library and
              // hosting the snapshots). Maestro doesn't ship public
              // landing pages — it's a local desktop tool, not a web
              // surface — so "false" is the honest answer here.
              ["Pre-computed FDA-drug screenings", false,    true,      false],
              // v1.20 — mutation-aware virtual screening (N×M ranked hit
              // list). Free servers offer single-compound docking; you
              // can't bulk-screen against a mutation panel. Maestro has
              // Glide HTVS but you build the receptor pipeline yourself
              // for every mutant — partial.
              ["Bulk VS with selectivity ranking", false,    true,      "partial"],
              // v1.13 — Liganx AI Beta. Q&A scoped to a job's results.
              // No comparable feature in free servers or Maestro.
              ["AI Q&A on your results",         false,     true,      false],
              // v1.00 + admet-ai 2.0.1 — extended ADMET (hERG, BBB, DILI,
              // CYP3A4/2D6) inline on every compound. Maestro has QikProp
              // which covers most of these, but as a separate run, not
              // inline with the dock score row.
              ["Inline ADMET (hERG/DILI/CYP/BBB)", false,    true,      "partial"],
              ["No install required",            true,      true,      false],
              ["Plain-English interpretation",   false,     true,      false],
              // Engine-choice row added 2026-04-30 alongside the GNINA
              // ship. Free servers ship one fixed engine (mostly Vina,
              // sometimes a stripped FlexX / SwissDock variant). Liganx
              // exposes QuickVina2-GPU + GNINA per job. Schrödinger has
              // multiple scoring stages (Glide HTVS / SP / XP) but
              // they're sequential on the same engine, not user-pickable
              // alternative engines, so this lands as "partial".
              ["Multiple scoring engines",       false,     true,      "partial"],
              // Maestro changed from false → "partial" 2026-04-30 after a
              // medicinal-chemistry audit pointed out Glide-DLDP and other
              // ML-rescoring add-ons. Liganx still differentiates by shipping
              // GNINA's CNN inline (no separate add-on / module purchase),
              // but a flat "false" was overstating Maestro's gap.
              ["CNN-based pose rescoring",       false,     true,      "partial"],
              // Boltz-2 row added 2026-04-30. AlphaFold-3-class ML co-folding
              // model — predicts pose + binding-affinity end-to-end from
              // sequence + SMILES. Free servers don't have it (research-grade
              // model with non-trivial GPU requirements). Maestro is "partial"
              // because Schrödinger has AlphaFold integrations but not the
              // affinity-head workflow as a first-class scoring engine yet.
              ["ML co-folding (Boltz-2 class)",  false,     true,      "partial"],
              // Library row added 2026-04-30 alongside the per-user compound
              // library ship. Free servers have no concept of a per-user
              // saved compound library. Maestro has Project favorites but
              // not the auto-save-on-name pattern with cross-job re-use.
              ["Personal compound library + tags", false,   true,      "partial"],
              // Re-run row — shipped 2026-04-30. Maestro has the rerun
              // workflow via Project entries but not in one click from a
              // history list with all parameters preserved.
              ["One-click re-run from history",  false,     true,      true],
              // Live SMILES validation — shipped 2026-04-30 with inline
              // 2D preview + 3D embed pre-check at submit. Maestro has
              // 2D depiction in its compound editor but doesn't pre-flight
              // 3D embedding before sending to Glide.
              ["Live SMILES preview + pre-flight", false,   true,      "partial"],
              // AI-design row added 2026-05-04 after Tier 1 #1-4 shipped.
              // No free server has AI variant generation tied to docking
              // results. Schrödinger's recent generative-chemistry work
              // (LiveDesign, AutoDesigner) lands as "partial" — it exists
              // but is a separate paid module on a different workflow,
              // not built into the same matrix UI as the docker.
              ["AI compound design (mutation-aware)", false, true,     "partial"],
              // Row labels generalized so the Schrödinger ✓ doesn't
              // imply they use the same OSS tools we do (PoseBusters,
              // RDKit). Schrödinger has equivalent functionality via
              // Glide validators / MacroModel — the generic labels keep
              // the comparison honest in either direction.
              ["Pose-quality validation",        false,     true,      true],
              ["Pose strain analysis",           false,     true,      true],
              ["Outside-pocket warning",         false,     true,      false],
              ["Interactive 3D pose viewer",     "partial", true,      true],
              ["2D contact map with distances",  false,     true,      true],
              ["Built-in molecule sketcher",     "partial", true,      true],
              // Dropped the specific "~3 s/cell" number from the row
              // label — that figure is accurate for the standard pocket
              // box at exhaustiveness=8 but a Thorough run or a much
              // larger pocket can land at 8-15 s/cell, and we'd rather
              // not have a user benchmark and feel misled.
              ["GPU-accelerated batch docking",  false,     true,      "partial"],
              ["Drug-likeness (QED, Ro5, PAINS)", false,    true,      true],
            ].map((row, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-5 py-3 font-medium text-ink dark:text-slate-100">{row[0]}</td>
                {[row[1], row[2], row[3]].map((v, j) => (
                  <td key={j} className={`px-5 py-3 text-center ${j === 1 ? "bg-delta-50/60 dark:bg-delta-900/20" : ""}`}>
                    <CompCell value={v as boolean | "partial" | string} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Light disclaimer below the comparison. Comparison tables age fast;
          flagging the snapshot date and licensing variance keeps the
          page hard to challenge as competitor capabilities shift. */}
        <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 text-center">
          Reflects publicly known features as of May 2026. Free-server and Schrödinger capabilities vary by version, license tier, and module.
        </p>

        {/* Method-honesty footnote added 2026-04-30 after a medicinal-chemistry
            + structural-biology audit. Two failure modes a working scientist
            would catch on close reading: (1) FoldX has academic licensing
            we surface as a bullet, (2) when FoldX isn't installed we fall
            back to PDBFixer applyMutations which substitutes the residue
            but does NOT minimise the structure — drastic substitutions
            can leave clash artefacts that move the score in ways that
            aren't pure binding-affinity signal. Saying so up front is
            cheaper than having a reviewer write the same thing on Twitter. */}
        <div className="mt-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-4 text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed">
          <div className="flex items-baseline justify-between mb-1.5 gap-3 flex-wrap">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
              Method limitations we publish on purpose
            </div>
            <Link
              to="/validation"
              className="text-[11px] text-delta-700 dark:text-delta-300 font-semibold hover:underline"
              title="Live scientific-validation page — 5/11 PASS, 5/11 documented method limits (NOISE), 1/11 explained-FAIL across the literature-anchored suite"
            >
              See full validation report →
            </Link>
          </div>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Eleven literature-anchored controls, public verdict.</strong> ABL T315I, EGFR T790M, BRAF V600E, KIT D816V, BTK C481S, KRAS G12C, EGFR C797S, EGFR L858R — five of eleven PASS at above-noise magnitude in the published direction. Five NOISE results sit in documented method-limit territory (covalent acrylamides, active-conformation selectivity, conformational activation). One FAIL (EGFR L858R + Gefitinib) is explained candidly with the structural reason — rigid-receptor docking can't capture L858R's conformational activation. The full per-case verdict and the open-source script that re-derives it are public.
            </li>
            <li>
              <strong>Vina noise floor.</strong> Vina/QuickVina2 scoring has roughly ±1 kcal/mol noise at default exhaustiveness. We surface a "within-noise" badge for any Δ inside that band so a reader doesn't over-interpret 0.3 kcal/mol shifts.
            </li>
            <li>
              <strong>Mutant-receptor build path.</strong> Our default mutant builder is FoldX BuildModel where an academic licence permits it; on environments without FoldX we fall back to PDBFixer's residue substitution, which applies the new identity but does <em>not</em> energy-minimise the structure. Drastic side-chain changes (e.g. small→large) can introduce clash signal in the Δ that isn't pure binding affinity. Submitting the same mutation in both modes and comparing flags this when it matters.
            </li>
            <li>
              <strong>FoldX academic licensing.</strong> FoldX is free for academic use under its own EULA but requires a commercial licence for industry workflows. Liganx ships the FoldX call path; users running commercial work should verify their licence with the FoldX team at the Centre for Genomic Regulation directly.
            </li>
            <li>
              <strong>Single-conformation rigid-receptor docking.</strong> We dock against one PDB conformation per (target, mutation). Mutations far from the binding pocket — typical for activation-loop, allosteric, or distant-domain residues — get an "outside pocket" badge instead of a possibly-misleading Δ, and the matrix shows them as not-scored rather than zero.
            </li>
          </ul>
        </div>
      </Container>
    </section>
  );
}
function CompCell({ value }: { value: boolean | "partial" | "coming" | string }) {
  if (value === true)  return <span className="text-emerald-600 dark:text-emerald-400 text-lg">✓</span>;
  if (value === false) return <span className="text-slate-300 dark:text-slate-600 text-lg">—</span>;
  if (value === "partial") return <span className="text-amber-600 dark:text-amber-400 text-xs font-semibold">partial</span>;
  if (value === "coming")  return <span className="text-delta-600 dark:text-delta-400 text-xs font-semibold">coming soon</span>;
  return <span className="text-slate-700 dark:text-slate-300 text-xs font-medium">{value}</span>;
}

/* ─── CTA strip ─────────────────────────────────────────────────────── */

function CTAStrip() {
  const { user } = useAuth();
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-delta-600 to-accent-500 text-white">
      {/* Soft radial highlight in the top-left to break up the flat
          gradient — matches the inner-card look the rounded version had,
          but spans the whole viewport now. */}
      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{
        backgroundImage: "radial-gradient(circle at 25% 25%, rgba(255,255,255,0.5), transparent 55%)",
      }} />
      <Container className="relative py-12 sm:py-20 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Stop hand-rolling mutation-aware docking.
        </h2>
        <p className="mt-3 text-delta-100 max-w-xl mx-auto">
          One UI. Real Vina under the hood. Selectivity matrix in minutes, not days.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {/* For anonymous visitors, the lead CTA is "Sign up free" since
              clicking "Run your first job" would just bounce them to
              /login anyway via RequireAuth. Authenticated users skip
              the sign-up button — they're already in. */}
          {!user && (
            <Link to="/signup" className="btn bg-white text-delta-700 hover:bg-delta-50 btn-lg shadow-sm">
              Sign up free <ArrowRight size={16} />
            </Link>
          )}
          <Link
            to="/studio"
            className={
              user
                ? "btn bg-white text-delta-700 hover:bg-delta-50 btn-lg shadow-sm"
                : "btn btn-lg bg-delta-700/30 text-white border-2 border-white/40 hover:bg-delta-700/50 backdrop-blur-sm"
            }
          >
            {user ? "Run your first job" : "Already a user? Run a job"} <ArrowRight size={16} />
          </Link>
        </div>
      </Container>
    </section>
  );
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center max-w-2xl mx-auto mb-8">
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink dark:text-slate-100">{title}</h2>
    </div>
  );
}
