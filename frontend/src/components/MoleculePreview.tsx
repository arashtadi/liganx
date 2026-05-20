/**
 * MoleculePreview — inline 2D structure thumbnail rendered from a SMILES.
 *
 * Calls the backend's /lookup/inspect-smiles (RDKit) at most once per ~400ms
 * of typing, so the user gets near-instant visual feedback on whether the
 * SMILES they typed is what they meant. Three states:
 *
 *   1. Empty SMILES → render nothing (the row already shows a placeholder).
 *   2. Loading      → faint shimmer placeholder, same size as the SVG.
 *   3. Valid        → the 2D depiction, plus inline action chips for any
 *                     useful corrections (Keep largest fragment, Use
 *                     canonical form).
 *   4. Invalid      → red X icon + the RDKit error message + "Open in
 *                     sketcher" button so the user can fix it visually.
 *
 * Clicking the thumbnail enlarges it into a centered modal (no Ketcher
 * dependency — just a bigger SVG) so the user can confirm the structure
 * even at small thumbnail sizes.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

interface Props {
  smiles: string;
  /** Thumbnail dimensions. Defaults are tuned for the compound row layout
   *  in Step 3. The big-preview modal uses much larger dimensions. */
  width?: number;
  height?: number;
  /** Called when the user clicks "Keep largest fragment" — caller swaps
   *  the row's SMILES to the largest-fragment SMILES. */
  onUseLargestFragment?: (smiles: string) => void;
  /** Called when the user clicks "Open in sketcher" on a parse error —
   *  caller opens Ketcher for this row. */
  onOpenInSketcher?: () => void;
  /** (U25) Dark-native depiction: light strokes + bright heteroatom
   *  palette on a transparent tile, instead of the default white card.
   *  Opt-in so existing light surfaces (the New-job form) are untouched. */
  dark?: boolean;
  /** (U25) When set, the atoms that differ from this reference SMILES
   *  (the maximum-common-substructure diff) are highlighted amber — i.e.
   *  the part that changes across a FEP edge. */
  refSmiles?: string;
}

export default function MoleculePreview({
  smiles,
  width = 160,
  height = 100,
  onUseLargestFragment,
  onOpenInSketcher,
  dark = false,
  refSmiles,
}: Props) {
  // Debounced — we only fire the inspect call after the user pauses
  // typing for 400 ms. Prevents a 50-keystroke SMILES from generating
  // 50 server round-trips. The internal useQuery cache also dedupes
  // the same SMILES across multiple compound rows.
  const debounced = useDebouncedValue(smiles.trim(), 400);
  const [zoomed, setZoomed] = useState(false);

  // (U25) Only extend the query key when the new options are actually
  // used, so default (light, no-highlight) callers keep the EXACT key
  // shape ["inspect-smiles", smiles, w, h] — preserving cache-sharing
  // with useSmilesValidity / useSmilesSaScore and zero behavior change.
  const extraKey = dark || refSmiles ? [dark, refSmiles ?? ""] : [];
  const { data, isFetching } = useQuery({
    queryKey: ["inspect-smiles", debounced, width, height, ...extraKey],
    queryFn: () =>
      api.inspectSmiles({
        smiles: debounced,
        width,
        height,
        ...(dark ? { dark: true } : {}),
        ...(refSmiles ? { ref_smiles: refSmiles } : {}),
      }),
    enabled: debounced.length > 0,
    staleTime: 5 * 60 * 1000,  // SMILES → depiction is deterministic
    retry: 1,
  });

  if (!debounced) {
    return (
      <div
        className="rounded-md border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-center text-[10px] text-slate-400 dark:text-slate-500"
        style={{ width, height }}
      >
        no SMILES
      </div>
    );
  }

  if (isFetching && !data) {
    return (
      <div
        className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 animate-pulse"
        style={{ width, height }}
      />
    );
  }

  if (!data) return null;

  if (!data.valid) {
    return (
      <div className="space-y-2" style={{ maxWidth: width }}>
        {/* Invalid card — softer than the previous flat slab. Uses an
            alert-triangle (more inviting than an X-circle, which reads
            as "blocked") inside a rose tile with a light gradient + a
            ring so it pops against the row's own rose glow.
            Aria-live so screen readers announce the change without
            shouting "ERROR" — "Invalid SMILES" is enough. */}
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg overflow-hidden border border-rose-300 dark:border-rose-700/50 bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/30 dark:to-rose-900/10 flex flex-col items-center justify-center text-rose-700 dark:text-rose-200 px-2 py-2 ring-1 ring-rose-200/60 dark:ring-rose-800/40"
          style={{ width, height }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <span className="text-[11px] font-semibold mt-1 text-center leading-tight">
            Invalid SMILES
          </span>
        </div>
        <div
          className="text-[10.5px] text-rose-800 dark:text-rose-200 leading-snug"
          title={data.error ?? undefined}
        >
          {data.error ?? "RDKit could not parse this SMILES."}
        </div>
        {onOpenInSketcher && (
          <button
            type="button"
            onClick={onOpenInSketcher}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-delta-600 hover:bg-delta-700 text-white transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Fix in sketcher
          </button>
        )}
      </div>
    );
  }

  const showFragmentWarn = data.fragment_count > 1 && data.largest_fragment;
  return (
    <div className="space-y-1" style={{ maxWidth: width }}>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className={
          "block rounded-lg border overflow-hidden transition hover:ring-2 hover:ring-delta-300 dark:hover:ring-delta-500/50 " +
          (dark
            // (U25) Dark-native tile: faint translucent surface + subtle
            // ring so the light-stroke SVG reads cleanly, instead of the
            // forced white card that clashed with the dark FEP page.
            ? "bg-slate-800/40 ring-1 ring-inset ring-white/5 " +
              (showFragmentWarn ? "border-amber-500/40" : "border-slate-700/70")
            : "bg-white dark:bg-white/95 " +
              (showFragmentWarn ? "border-amber-300 dark:border-amber-600/40" : "border-slate-200 dark:border-slate-700"))
        }
        style={{ width, height }}
        title="Click to enlarge"
        aria-label="Enlarge molecule preview"
      >
        {data.svg ? (
          // RDKit-emitted SVG. Trusted (server-rendered, not user-supplied).
          <span dangerouslySetInnerHTML={{ __html: data.svg }} />
        ) : (
          <span className="flex items-center justify-center w-full h-full text-[10px] text-slate-400">
            (no depiction)
          </span>
        )}
      </button>
      {showFragmentWarn && data.largest_fragment && (
        <div className="text-[10px] text-amber-800 dark:text-amber-300 leading-snug">
          {data.fragment_count} disconnected fragments.
          {onUseLargestFragment && (
            <button
              type="button"
              onClick={() => onUseLargestFragment(data.largest_fragment!.smiles)}
              className="ml-1 font-semibold text-delta-700 hover:underline dark:text-delta-300"
            >
              Keep largest ({data.largest_fragment.atom_count} atoms)
            </button>
          )}
        </div>
      )}
      {zoomed && data.svg && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={() => setZoomed(false)}
          role="dialog"
        >
          <div
            className={
              "rounded-xl shadow-2xl p-4 max-w-2xl " +
              (dark
                ? "bg-slate-900 ring-1 ring-slate-700"
                : "bg-white ring-1 ring-slate-200")
            }
            onClick={(e) => e.stopPropagation()}
          >
            <BigPreview smiles={debounced} dark={dark} refSmiles={refSmiles} />
            <div className={"mt-2 text-[11px] font-mono break-all " + (dark ? "text-slate-300" : "text-slate-600")}>
              {data.canonical_smiles ?? debounced}
            </div>
            <div className="text-[11px] text-slate-500 mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setZoomed(false)}
                className="btn-ghost btn-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Larger 600×400 SVG fetched on demand when the user clicks the
 *  thumbnail. Separate query so the small thumbnail isn't re-fetched
 *  at the larger size; the cache naturally splits by (smiles, w, h). */
function BigPreview({ smiles, dark = false, refSmiles }: { smiles: string; dark?: boolean; refSmiles?: string }) {
  const extraKey = dark || refSmiles ? [dark, refSmiles ?? ""] : [];
  const { data } = useQuery({
    queryKey: ["inspect-smiles", smiles, 600, 400, ...extraKey],
    queryFn: () =>
      api.inspectSmiles({
        smiles,
        width: 600,
        height: 400,
        ...(dark ? { dark: true } : {}),
        ...(refSmiles ? { ref_smiles: refSmiles } : {}),
      }),
    staleTime: 5 * 60 * 1000,
  });
  if (!data?.svg) {
    return <div className="w-[600px] h-[400px] flex items-center justify-center text-sm text-slate-400">Loading…</div>;
  }
  return <div dangerouslySetInnerHTML={{ __html: data.svg }} />;
}

/** Tiny debounce hook — the React-Query staleTime can't help us here
 *  because we want to avoid keying ON the in-flight value at all (the
 *  query key would change on every keystroke and trigger a flood). */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [value, delay]);
  return debounced;
}

/** Validity verdict for a SMILES, derived from the same /lookup/inspect-smiles
 *  query the inline MoleculePreview uses. The cache key matches MoleculePreview's
 *  default (140×88) so this hook hits the same cache entry — no extra requests.
 *
 *  Use this in the parent compound row to drive row-level styling (rose glow
 *  for invalid, amber tint for fragments, brand-blue for valid). The actual
 *  thumbnail rendering still lives in MoleculePreview. */
export type SmilesValidity = "empty" | "loading" | "valid" | "invalid" | "fragments";

export function useSmilesValidity(smiles: string): SmilesValidity {
  // No debounce — the inspect-smiles endpoint is RDKit-only (~10 ms
  // server-side) and React Query caches by SMILES (5min staleTime),
  // so a rapid burst of edits hits the cache for repeats and only the
  // current SMILES makes a fresh round-trip. The earlier 150ms debounce
  // was the main reason the validity dot felt out of sync — it
  // coalesced rapid sketches into stale snapshots. With Ketcher's
  // change-event push (KetcherModal.tsx) feeding `smiles` in real time,
  // removing the debounce gives the dot effectively zero latency on
  // valid/invalid transitions.
  const trimmed = smiles.trim();
  const { data, isFetching } = useQuery({
    queryKey: ["inspect-smiles", trimmed, 140, 88],
    queryFn: () => api.inspectSmiles({ smiles: trimmed, width: 140, height: 88 }),
    enabled: trimmed.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const debounced = trimmed; // legacy var name kept below
  if (!debounced) return "empty";
  if (!data) return isFetching ? "loading" : "loading";
  if (!data.valid) return "invalid";
  if (data.fragment_count > 1) return "fragments";
  return "valid";
}

/** Synthetic Accessibility score [1=easy, 10=impossible] read from
 *  the SAME inspect-smiles cache entry as useSmilesValidity. Returns
 *  { score, label } or null if the SMILES isn't valid yet. The shared
 *  cache key means calling both hooks in the same component costs one
 *  network round-trip total, not two. */
export function useSmilesSaScore(smiles: string): { score: number; label: string } | null {
  // Same no-debounce reasoning as useSmilesValidity — and intentionally
  // SAME queryKey shape so calling both hooks for the same SMILES is a
  // single network round-trip via React Query's cache.
  const trimmed = smiles.trim();
  const { data } = useQuery({
    queryKey: ["inspect-smiles", trimmed, 140, 88],
    queryFn: () => api.inspectSmiles({ smiles: trimmed, width: 140, height: 88 }),
    enabled: trimmed.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  if (!data || !data.valid || data.sa_score == null) return null;
  return { score: data.sa_score, label: data.sa_label ?? "unknown" };
}
