import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type CatalogTarget } from "../api";
import { ArrowRight, Spinner, Target } from "../components/Icons";

export default function LibraryPage() {
  const { data, isLoading } = useQuery({ queryKey: ["catalog"], queryFn: api.catalog });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-500">
        <Spinner size={20} className="mr-2" /> Loading library…
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <header>
        <div className="eyebrow">Curated mutation library</div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink dark:text-slate-100">
          Clinically actionable targets, ready to dock.
        </h1>
        <p className="mt-2 muted max-w-2xl dark:text-slate-300">
          Each entry includes a default WT structure with a pre-defined pocket box, the
          mutations that matter clinically, and approved or well-characterized reference
          compounds — so you're docking real chemistry against the right pockets in seconds.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {data?.map((t) => (
          <TargetCard key={t.id} target={t} />
        ))}
      </div>
    </div>
  );
}

function TargetCard({ target }: { target: CatalogTarget }) {
  return (
    <article className="card-hover">
      <header className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-delta-500 to-accent-500 text-white flex items-center justify-center shadow-sm">
              <Target size={18} />
            </span>
            <div>
              <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500">{target.uniprot} · PDB {target.pdb_id}</div>
              <h2 className="text-lg font-bold text-ink dark:text-slate-100 leading-tight">{target.name}</h2>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {target.indications.map((ind) => (
              <span key={ind} className="badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">{ind}</span>
            ))}
          </div>
        </div>
        <Link
          to={`/new?target=${target.id}`}
          className="btn-secondary btn-sm shrink-0"
          title="Pre-fill new job with this target"
        >
          Use <ArrowRight size={12} />
        </Link>
      </header>

      <p className="text-sm text-slate-600 leading-relaxed dark:text-slate-400">{target.description}</p>

      <div className="mt-4">
        <div className="label">Mutations ({target.mutations.length})</div>
        <div className="flex flex-wrap gap-1.5">
          {target.mutations.map((m) => (
            <span key={m.code} className="chip" title={m.significance}>
              <span className="font-mono font-semibold">{m.code}</span>
              <span className="hidden md:inline text-slate-500 font-normal">— {m.significance.split(",")[0]}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="label">Reference compounds ({target.compounds.length})</div>
        <ul className="text-xs space-y-1">
          {target.compounds.map((c) => (
            <li key={c.name} className="flex items-baseline gap-2">
              <span className="font-semibold text-ink dark:text-slate-100">{c.name}</span>
              <span className="text-slate-500 dark:text-slate-400">— {c.mechanism}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
