import { Link } from "react-router-dom";
import {
  ArrowRight, Beaker, Bolt, Eye, Grid, Library, Shield, Sparkles, Target,
} from "../components/Icons";

export default function HomePage() {
  return (
    <div className="space-y-20">
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

/* ─── Hero ──────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-white border border-slate-200/80 shadow-soft dark:bg-slate-900 dark:border-slate-800">
      {/* background flourish */}
      <div className="pointer-events-none absolute inset-0 bg-hero-grid" />
      <div className="pointer-events-none absolute -top-32 -right-32 w-96 h-96 rounded-full bg-delta-100/60 blur-3xl dark:bg-delta-700/30" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-accent-400/20 blur-3xl dark:bg-accent-500/20" />

      <div className="relative grid grid-cols-1 lg:grid-cols-5 gap-8 p-8 sm:p-12 lg:p-14">
        <div className="lg:col-span-3 flex flex-col justify-center">
          <div className="eyebrow flex items-center gap-2">
            <Sparkles size={14} /> Mutation-aware docking
          </div>
          <h1 className="mt-4 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-ink dark:text-white leading-[1.05]">
            Find compounds that
            <br />
            <span className="bg-gradient-to-r from-delta-600 to-accent-500 bg-clip-text text-transparent dark:from-delta-400 dark:to-accent-400">
              prefer the mutant.
            </span>
          </h1>
          <p className="mt-6 text-lg text-slate-600 dark:text-slate-300 max-w-xl leading-relaxed">
            Pick a clinically relevant mutation. Pick your compounds. We dock against
            wild-type <em>and</em> mutant in parallel and show exactly which compounds
            gain selectivity — no PyMOL, FoldX, or AutoDock setup.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/new" className="btn-primary btn-lg">
              Start a docking run <ArrowRight size={16} />
            </Link>
            <Link to="/library" className="btn-secondary btn-lg">
              Browse mutation library
            </Link>
          </div>
          <div className="mt-6 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5"><Check /> No install</span>
            <span className="flex items-center gap-1.5"><Check /> Vina under the hood</span>
            <span className="flex items-center gap-1.5"><Check /> Free for academic use</span>
          </div>
        </div>

        <div className="lg:col-span-2 flex items-center justify-center">
          <MatrixPreview />
        </div>
      </div>
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
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Compound X</span> is predicted to bind
        the <strong className="dark:text-slate-200">T790M mutant</strong> 1.7 kcal/mol better than wild-type — a candidate
        for resistance.
      </div>
    </div>
  );
}

/* ─── Logo strip ────────────────────────────────────────────────────── */

function LogoStrip() {
  return (
    <section className="text-center">
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
    <section>
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
      icon: <Bolt />,
      title: "GPU-accelerated docking",
      body: "QuickVina2-GPU on RunPod with batched dispatch — typical cells finish in seconds, not minutes. Real Vina scoring, not a placeholder.",
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
      body: "If your mutation is far from the docking box, we tell you up-front instead of letting you read meaning into a noise-level Δ.",
    },
    {
      icon: <Library />,
      title: "Curated mutation library",
      body: "30+ clinically actionable mutations across EGFR, KRAS, BRAF, ALK, MET, ABL, BTK, KIT and more — with verified pocket boxes.",
    },
    {
      icon: <Sparkles />,
      title: "Drug-likeness panel",
      body: "QED, Lipinski Ro5, Veber, PAINS alerts, MW / LogP / TPSA / HBD-HBA / rotatable bonds — every compound, every cell.",
    },
  ];
  return (
    <section>
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
  const items = [
    {
      tag: "Just shipped",
      title: "Built-in 2D molecule sketcher",
      body:
        "Draw or edit any compound visually with the EPAM Ketcher editor — no SMILES typing, no install. Self-hosted, same-origin, ~25 MB lazy-loaded.",
      tone: "delta" as const,
    },
    {
      tag: "Shipped this week",
      title: "GPU batch docking",
      body:
        "Pod-side batched QuickVina2-GPU dispatch — N ligands per dispatch instead of N round-trips. Validation runs in parallel after the cells flip OK.",
      tone: "accent" as const,
    },
    {
      tag: "Shipped this week",
      title: "Pose strain + outside-pocket honesty",
      body:
        "RDKit MMFF strain catches Vina junk poses; mutations far from the docking box get a noise badge so you don't read biology into a 0.1 Δ.",
      tone: "emerald" as const,
    },
  ];
  return (
    <section>
      <SectionHead eyebrow="What's new" title="Recently shipped." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {items.map((it) => (
          <div
            key={it.title}
            className="card relative ring-1 ring-slate-200/70 dark:ring-slate-700/60 overflow-hidden"
          >
            <span
              className={
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                (it.tone === "delta"
                  ? "bg-delta-50 text-delta-700 ring-1 ring-inset ring-delta-200 dark:bg-delta-900/30 dark:text-delta-300 dark:ring-delta-700/40"
                  : it.tone === "accent"
                    ? "bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200 dark:bg-accent-900/30 dark:text-accent-300 dark:ring-accent-700/40"
                    : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700/40")
              }
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {it.tag}
            </span>
            <h3 className="mt-3 font-semibold text-ink dark:text-slate-100">{it.title}</h3>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Comparison ────────────────────────────────────────────────────── */

function Comparison() {
  return (
    <section>
      <SectionHead eyebrow="Where we sit" title="The missing middle." />
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
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
              ["No install required",            true,      true,      false],
              ["Plain-English interpretation",   false,     true,      false],
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
        Reflects publicly known features as of April 2026. Free-server and Schrödinger capabilities vary by version, license tier, and module.
      </p>
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
  return (
    <section className="rounded-3xl overflow-hidden relative bg-gradient-to-br from-delta-600 to-accent-500 text-white p-10 sm:p-14 text-center">
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.5), transparent 50%)",
      }} />
      <div className="relative">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Stop hand-rolling mutation-aware docking.
        </h2>
        <p className="mt-3 text-delta-100 max-w-xl mx-auto">
          One UI. Real Vina under the hood. Selectivity matrix in minutes, not days.
        </p>
        <div className="mt-7 flex justify-center gap-3">
          {/* CTA banner uses brand gradient in both themes — buttons stay
              light-on-gradient. The "View on GitHub" button was removed
              alongside the Liganx repo being kept private — the link
              pointed at github.com root which felt placeholdery. */}
          <Link to="/new" className="btn bg-white text-delta-700 hover:bg-delta-50 btn-lg shadow-sm">
            Run your first job <ArrowRight size={16} />
          </Link>
        </div>
      </div>
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
