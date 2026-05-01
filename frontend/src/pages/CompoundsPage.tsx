/**
 * /compounds — user's saved compound library.
 *
 * Surfaces what's auto-saved by the New-job form (any row that has both
 * a name and a SMILES). Users can browse, copy a SMILES to their clipboard,
 * jump back to /new with the compound pre-loaded, or remove an entry from
 * the library entirely.
 *
 * The auto-save flow itself lives in NewJobPage — this page is the
 * read/manage surface, plus a one-click "Use in new job" path so the
 * library actually gets used.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type UserCompound } from "../api";
import { Beaker, Close, Spinner, ArrowRight } from "../components/Icons";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function CompoundsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [copyFlash, setCopyFlash] = useState<number | null>(null);

  const { data: compounds = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["my-compounds"],
    queryFn: api.getMyCompounds,
    staleTime: 5 * 60 * 1000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteMyCompound(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["my-compounds"] }); },
  });

  const filtered = compounds.filter((c) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.smiles.toLowerCase().includes(q);
  });

  function copyToClipboard(c: UserCompound) {
    navigator.clipboard.writeText(c.smiles).then(() => {
      setCopyFlash(c.id);
      window.setTimeout(() => setCopyFlash(null), 1500);
    }).catch(() => { /* clipboard write blocked — silent */ });
  }

  function useInNewJob(c: UserCompound) {
    // Navigate to /new with reseed state so the form pre-fills with this
    // compound. Mirrors the History "Re-run" pattern. The user picks the
    // target separately on the New-job page.
    navigate("/new", {
      state: {
        reseed: {
          compounds: [{ name: c.name, smiles: c.smiles }],
        },
      },
    });
  }

  return (
    <div className="space-y-5">
      <header>
        <Link to="/history" className="text-xs text-slate-500 hover:text-delta-600 dark:text-slate-400 dark:hover:text-delta-400 inline-flex items-center gap-1">
          ← Back to history
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink dark:text-slate-100">
          My compounds
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
          Custom structures auto-saved from your docking jobs. Any compound
          you give a name in the New-job form lands here, ready to re-use in
          a single click.
        </p>
      </header>

      {/* Search bar — present even on small libraries so users build the
          muscle memory; hides the row of compounds otherwise. */}
      {compounds.length > 0 && (
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or SMILES…"
            className="input flex-1"
          />
          <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {filtered.length} of {compounds.length}
          </span>
        </div>
      )}

      {isLoading && (
        <div className="card flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Spinner size={14} /> Loading your library…
        </div>
      )}

      {isError && (
        <div className="card border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300 text-sm">
          <div className="font-semibold mb-1">Couldn&apos;t load your library</div>
          <div>{error instanceof ApiError ? error.message : "Try refreshing."}</div>
          <button onClick={() => refetch()} className="mt-2 btn-ghost btn-sm">
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && compounds.length === 0 && (
        <div className="card text-center py-10">
          <div className="mx-auto w-12 h-12 rounded-full bg-delta-50 text-delta-600 dark:bg-delta-900/30 dark:text-delta-400 flex items-center justify-center mb-3">
            <Beaker size={22} />
          </div>
          <h2 className="text-base font-semibold text-ink dark:text-slate-100">
            No saved compounds yet
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            Add a compound to a New-job form, give it a name, and it&apos;ll
            auto-save here. You can then re-use it in any future job with
            one click.
          </p>
          <Link to="/new" className="btn-primary btn-sm mt-4 inline-flex">
            Start a new job <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="card divide-y divide-slate-200 dark:divide-slate-700 p-0 overflow-hidden">
          {filtered.map((c) => (
            <div key={c.id} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-ink dark:text-slate-100 truncate">{c.name}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      saved {fmtDate(c.created_at)}
                      {c.updated_at !== c.created_at && ` · updated ${fmtDate(c.updated_at)}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(c)}
                    className="mt-1 block text-left font-mono text-[11px] text-slate-600 dark:text-slate-400 truncate hover:text-delta-700 dark:hover:text-delta-300 transition-colors"
                    title={`Copy SMILES — ${c.smiles}`}
                  >
                    {copyFlash === c.id ? "✓ Copied to clipboard" : c.smiles}
                  </button>
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => useInNewJob(c)}
                    className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-delta-700 hover:bg-delta-50 dark:text-delta-300 dark:hover:bg-delta-900/30 transition-colors"
                    title="Open the New-job form with this compound pre-loaded"
                  >
                    Use in new job <ArrowRight size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Remove "${c.name}" from your library? Past jobs that used it are unaffected.`)) {
                        deleteMut.mutate(c.id);
                      }
                    }}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 dark:hover:text-rose-300 transition-colors"
                    title={`Remove ${c.name} from library`}
                    aria-label={`Remove ${c.name}`}
                  >
                    <Close size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && compounds.length > 0 && filtered.length === 0 && (
        <div className="card text-center text-sm text-slate-500 dark:text-slate-400">
          No matches for &ldquo;{filter}&rdquo;.
        </div>
      )}
    </div>
  );
}
