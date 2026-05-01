/**
 * /compounds — user's saved compound library.
 *
 * Surfaces what's auto-saved by the New-job form (any row that has both
 * a name and a SMILES). Users can browse, copy a SMILES, jump back to
 * /new with a compound pre-loaded, EDIT the structure in Ketcher (and
 * choose save-changes vs save-as-new), apply colored TAGS to organize
 * their library (same preset palette as History), filter by tag, and
 * remove entries.
 *
 * The auto-save flow itself lives in NewJobPage — this page is the
 * read/manage surface plus the structural-edit + tag-filter surfaces.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type UserCompound } from "../api";
import { Beaker, Close, Spinner, ArrowRight } from "../components/Icons";
import KetcherModal from "../components/KetcherModal";
import RenamePrompt from "../components/RenamePrompt";
import { TAG_PRESETS, TAG_BY_VALUE, CUSTOM_TAG_CHIP, sortTags } from "../lib/jobTags";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function CompoundsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [activeTagFilters, setActiveTagFilters] = useState<Set<string>>(new Set());
  const [copyFlash, setCopyFlash] = useState<number | null>(null);

  // Edit-flow state — modal layers that can stack on this page:
  //   sketcherFor    → Ketcher modal open for editing this compound
  //   creatingNew    → Ketcher modal open with an empty canvas (Create button)
  //   savePrompt     → after Ketcher returns a CHANGED smiles in edit
  //                    mode, ask "Save changes" vs "Save as new" vs Cancel
  //   renamePrompt   → collect a unique name; used by both "Save as new"
  //                    edit branch and the Create-from-scratch branch
  const [sketcherFor, setSketcherFor] = useState<UserCompound | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [savePrompt, setSavePrompt] = useState<{ original: UserCompound; newSmiles: string } | null>(null);
  const [renamePrompt, setRenamePrompt] = useState<{
    originalName: string;
    newSmiles: string;
    /** "edit-as-new" = user edited an existing compound and chose Save as new
     *  → the original stays untouched, prompt copy reassures them.
     *  "create"      = drawn from scratch via the Create button → no
     *  pre-existing entry to mention. */
    mode: "edit-as-new" | "create";
  } | null>(null);

  const { data: compounds = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["my-compounds"],
    queryFn: api.getMyCompounds,
    staleTime: 5 * 60 * 1000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteMyCompound(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["my-compounds"] }); },
  });
  const saveMut = useMutation({
    mutationFn: (payload: { name: string; smiles: string }) => api.saveMyCompound(payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["my-compounds"] }); },
  });
  const tagsMut = useMutation({
    mutationFn: ({ id, tags }: { id: number; tags: string[] }) => api.saveMyCompoundTags(id, tags),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["my-compounds"] }); },
  });

  // Aggregated set of tags currently in use across the library — drives
  // the filter-bar chips at the top of the page. Only show tags that
  // actually exist on a compound, so the filter row stays honest.
  const allUsedTags = useMemo(() => {
    const acc = new Set<string>();
    for (const c of compounds) for (const t of c.tags ?? []) acc.add(t);
    return sortTags(Array.from(acc));
  }, [compounds]);

  // Filtered view — text filter (name/SMILES contains) AND any selected
  // tag filters (OR semantics: a row matches if it has ANY of the chosen
  // tags). Mirrors the History page filter behaviour for consistency.
  const filtered = useMemo(() => {
    return compounds.filter((c) => {
      if (filter.trim()) {
        const q = filter.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !c.smiles.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (activeTagFilters.size > 0) {
        const has = (c.tags ?? []).some((t) => activeTagFilters.has(t));
        if (!has) return false;
      }
      return true;
    });
  }, [compounds, filter, activeTagFilters]);

  function copyToClipboard(c: UserCompound) {
    navigator.clipboard.writeText(c.smiles).then(() => {
      setCopyFlash(c.id);
      window.setTimeout(() => setCopyFlash(null), 1500);
    }).catch(() => { /* clipboard write blocked — silent */ });
  }

  function useInNewJob(c: UserCompound) {
    navigate("/new", {
      state: {
        reseed: { compounds: [{ name: c.name, smiles: c.smiles }] },
      },
    });
  }

  function toggleTagFilter(t: string) {
    setActiveTagFilters((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <Link to="/history" className="text-xs text-slate-500 hover:text-delta-600 dark:text-slate-400 dark:hover:text-delta-400 inline-flex items-center gap-1">
            ← Back to history
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink dark:text-slate-100">
            My compounds
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            Custom structures auto-saved from your docking jobs. Draw a new
            one from scratch, edit a structure in the sketcher, tag for
            organization, or jump any compound into a new run in one click.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreatingNew(true)}
          className="btn-primary btn-sm whitespace-nowrap inline-flex items-center gap-1.5"
          title="Open the 2D sketcher with an empty canvas to draw a new compound"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create compound
        </button>
      </header>

      {compounds.length > 0 && (
        <div className="space-y-3">
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
          {/* Tag filter strip — only shown when any compound has any tag.
              OR semantics: clicking multiple tags shows compounds that
              have AT LEAST ONE of them. Same pattern as History. */}
          {allUsedTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mr-1">
                Filter
              </span>
              {allUsedTags.map((t) => {
                const active = activeTagFilters.has(t);
                const preset = TAG_BY_VALUE[t];
                const chip = preset?.chip ?? CUSTOM_TAG_CHIP;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTagFilter(t)}
                    className={
                      `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-opacity ${chip} ` +
                      (active ? "" : "opacity-60 hover:opacity-100")
                    }
                    title={active ? `Click to remove "${preset?.label ?? t}" from filters` : `Filter by "${preset?.label ?? t}"`}
                  >
                    {preset && <span aria-hidden="true">{preset.icon}</span>}
                    <span>{preset?.label ?? t}</span>
                  </button>
                );
              })}
              {activeTagFilters.size > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTagFilters(new Set())}
                  className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 ml-1"
                >
                  Clear
                </button>
              )}
            </div>
          )}
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
            auto-save here.
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
                  <CompoundTagStrip
                    tags={c.tags ?? []}
                    onChange={(next) => tagsMut.mutate({ id: c.id, tags: next })}
                    pending={tagsMut.isPending && tagsMut.variables?.id === c.id}
                  />
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setSketcherFor(c)}
                    className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-delta-700 hover:bg-delta-50 dark:text-slate-400 dark:hover:text-delta-300 dark:hover:bg-delta-900/30 transition-colors"
                    title="Open the structure in the 2D sketcher"
                  >
                    Edit
                  </button>
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
          No matches for the current filters.
        </div>
      )}

      {/* ── Edit / Create flow modals ──────────────────────────────── */}
      {sketcherFor && (
        <KetcherModal
          initialSmiles={sketcherFor.smiles}
          onClose={() => setSketcherFor(null)}
          onAccept={(newSmiles) => {
            const original = sketcherFor;
            setSketcherFor(null);
            // No structural change → no-op (same as just closing).
            if (newSmiles === original.smiles) return;
            // Hand off to the chooser: save-changes (overwrite same name)
            // vs save-as-new (open RenamePrompt) vs cancel.
            setSavePrompt({ original, newSmiles });
          }}
        />
      )}

      {/* Create-from-scratch path — Ketcher opens with an empty canvas;
          on accept we route straight to the rename prompt because there's
          no existing compound to overwrite, so the SaveModeChooser would
          be a meaningless intermediate step. */}
      {creatingNew && (
        <KetcherModal
          onClose={() => setCreatingNew(false)}
          onAccept={(newSmiles) => {
            setCreatingNew(false);
            // KetcherModal already guards against empty canvas on accept,
            // but be defensive: only proceed with a non-empty SMILES.
            if (!newSmiles.trim()) return;
            // Pre-fill the rename input with a friendly placeholder so the
            // user has something to type INTO rather than staring at a
            // blank field — they can wipe and rename instantly.
            setRenamePrompt({ originalName: "Compound", newSmiles, mode: "create" });
          }}
        />
      )}

      {savePrompt && (
        <SaveModeChooser
          originalName={savePrompt.original.name}
          onSaveChanges={() => {
            saveMut.mutate({ name: savePrompt.original.name, smiles: savePrompt.newSmiles });
            setSavePrompt(null);
          }}
          onSaveAsNew={() => {
            setRenamePrompt({ originalName: savePrompt.original.name, newSmiles: savePrompt.newSmiles, mode: "edit-as-new" });
            setSavePrompt(null);
          }}
          onCancel={() => setSavePrompt(null)}
        />
      )}

      {renamePrompt && (
        <RenamePrompt
          // For edit-as-new we suggest "OldName_" so the user can append a
          // suffix; for create-from-scratch we just put "Compound" as a
          // visible placeholder they're meant to wipe.
          initialName={renamePrompt.mode === "create" ? "" : renamePrompt.originalName + "_"}
          existingNames={compounds.map((c) => c.name)}
          // No "current row" to preserve — this is genuinely a new entry,
          // so even the original name should be blocked as a duplicate.
          // We pass an empty currentRowName so the existence check excludes
          // nothing.
          currentRowName=""
          title={renamePrompt.mode === "create" ? "Name your new compound" : "Save as a new compound"}
          subtitle={
            renamePrompt.mode === "create" ? (
              <>Pick a name for the structure you just drew. It&apos;ll be saved to your library so you can re-use it in future jobs.</>
            ) : (
              <>Pick a name for the new structure. <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{renamePrompt.originalName}</span> stays in your library unchanged.</>
            )
          }
          submitLabel={renamePrompt.mode === "create" ? "Create compound" : "Save new compound"}
          onCancel={() => setRenamePrompt(null)}
          onSave={(newName) => {
            saveMut.mutate({ name: newName, smiles: renamePrompt.newSmiles });
            setRenamePrompt(null);
          }}
        />
      )}
    </div>
  );
}

/** Per-row tag strip — colored chips that match the History tag palette,
 *  with a "+ Tag" trigger that opens a small inline picker. Simpler than
 *  the History TagPicker (no portal, no scroll-tracking) because the
 *  CompoundsPage layout doesn't have an overflow-hidden parent that
 *  would clip the picker. Kept inline here rather than extracted because
 *  the CompoundsPage tag UX may diverge from History over time. */
function CompoundTagStrip({
  tags,
  onChange,
  pending,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  pending: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");
  // Optimistic local copy so chip clicks feel instant. The mutation
  // re-fetches behind the scenes.
  const [local, setLocal] = useState(tags);
  useEffect(() => { setLocal(tags); }, [tags]);

  // Click-outside to close the picker.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen]);

  function commit(next: string[]) {
    setLocal(next);
    onChange(next);
  }

  function togglePreset(value: string) {
    const next = local.includes(value)
      ? local.filter((t) => t !== value)
      : [...local, value];
    commit(next);
  }

  function addCustom() {
    const t = custom.trim();
    if (!t) return;
    if (local.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setCustom("");
      return;
    }
    commit([...local, t]);
    setCustom("");
  }

  const sorted = sortTags(local);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 relative" ref={wrapRef}>
      {sorted.map((value) => {
        const preset = TAG_BY_VALUE[value];
        const chip = preset?.chip ?? CUSTOM_TAG_CHIP;
        return (
          <button
            key={value}
            type="button"
            onClick={() => commit(local.filter((t) => t !== value))}
            className={`group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${chip}`}
            title="Click to remove this tag"
          >
            {preset && <span aria-hidden="true">{preset.icon}</span>}
            <span>{preset?.label ?? value}</span>
            <span className="text-[10px] opacity-50 group-hover:opacity-100 transition-opacity">×</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-dashed ring-slate-300 hover:ring-slate-400 hover:text-slate-700 dark:text-slate-400 dark:ring-slate-700 dark:hover:ring-slate-500 dark:hover:text-slate-200"
        title="Add a tag to this compound"
      >
        <span aria-hidden="true">+</span>
        <span>Tag</span>
      </button>
      {pending && <Spinner size={10} className="text-slate-400" />}
      {pickerOpen && (
        <div className="absolute left-0 top-full mt-1.5 z-30 w-64 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg p-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1">
            {TAG_PRESETS.map((p) => {
              const active = local.includes(p.value);
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => togglePreset(p.value)}
                  className={
                    `flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium text-left ring-1 ring-inset ${p.chip} ` +
                    (active ? "" : "opacity-60 hover:opacity-100")
                  }
                >
                  <span aria-hidden="true">{p.icon}</span>
                  <span>{p.label}</span>
                  {active && <span className="ml-auto text-[10px]">✓</span>}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-700">
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addCustom(); }
              }}
              placeholder="Custom tag…"
              maxLength={40}
              className="input flex-1 text-[11px] h-7 px-2"
            />
            <button
              type="button"
              onClick={addCustom}
              disabled={!custom.trim()}
              className="btn-primary btn-sm text-[11px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Three-way chooser shown after Ketcher returns a CHANGED structure for
 *  a saved compound. Save changes overwrites the current row's SMILES;
 *  Save as new opens the rename prompt; Cancel drops the change. */
function SaveModeChooser({
  originalName,
  onSaveChanges,
  onSaveAsNew,
  onCancel,
}: {
  originalName: string;
  onSaveChanges: () => void;
  onSaveAsNew: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-base font-semibold text-ink dark:text-white">
            Save the modified structure
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            You changed the structure of <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{originalName}</span>.
            Choose what to do with the change.
          </p>
        </header>
        <div className="px-5 py-4 space-y-2">
          <button
            type="button"
            onClick={onSaveChanges}
            className="w-full text-left p-3 rounded-md border border-slate-200 hover:border-delta-400 hover:bg-delta-50 dark:border-slate-700 dark:hover:border-delta-500 dark:hover:bg-delta-900/30 transition-colors"
          >
            <div className="font-semibold text-sm text-ink dark:text-slate-100">
              Save changes to <span className="font-mono">{originalName}</span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
              Overwrites the current SMILES under the same name. Tags are preserved.
            </div>
          </button>
          <button
            type="button"
            onClick={onSaveAsNew}
            className="w-full text-left p-3 rounded-md border border-slate-200 hover:border-delta-400 hover:bg-delta-50 dark:border-slate-700 dark:hover:border-delta-500 dark:hover:bg-delta-900/30 transition-colors"
          >
            <div className="font-semibold text-sm text-ink dark:text-slate-100">
              Save as a new compound
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
              Keeps <span className="font-mono">{originalName}</span> as-is and adds the new structure under a different name.
            </div>
          </button>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="btn-ghost btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
