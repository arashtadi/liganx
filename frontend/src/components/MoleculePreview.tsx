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
}

export default function MoleculePreview({
  smiles,
  width = 160,
  height = 100,
  onUseLargestFragment,
  onOpenInSketcher,
}: Props) {
  // Debounced — we only fire the inspect call after the user pauses
  // typing for 400 ms. Prevents a 50-keystroke SMILES from generating
  // 50 server round-trips. The internal useQuery cache also dedupes
  // the same SMILES across multiple compound rows.
  const debounced = useDebouncedValue(smiles.trim(), 400);
  const [zoomed, setZoomed] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ["inspect-smiles", debounced, width, height],
    queryFn: () => api.inspectSmiles({ smiles: debounced, width, height }),
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
      <div className="space-y-1" style={{ maxWidth: width }}>
        <div
          className="rounded-md border border-rose-300 dark:border-rose-800/50 bg-rose-50 dark:bg-rose-900/20 flex flex-col items-center justify-center text-rose-700 dark:text-rose-300 px-2 py-1.5"
          style={{ width, height }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6M9 9l6 6" />
          </svg>
          <span className="text-[10px] font-semibold mt-0.5 text-center leading-tight">
            Invalid SMILES
          </span>
        </div>
        <div
          className="text-[10px] text-rose-700 dark:text-rose-400 leading-snug"
          title={data.error ?? undefined}
        >
          {data.error ?? "RDKit could not parse this SMILES."}
        </div>
        {onOpenInSketcher && (
          <button
            type="button"
            onClick={onOpenInSketcher}
            className="text-[10px] font-semibold text-delta-700 hover:underline dark:text-delta-300"
          >
            Open in sketcher to fix →
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
          "block rounded-md border bg-white dark:bg-white/95 overflow-hidden hover:ring-2 hover:ring-delta-300 dark:hover:ring-delta-500/40 transition " +
          (showFragmentWarn ? "border-amber-300 dark:border-amber-600/40" : "border-slate-200 dark:border-slate-700")
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
            className="bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 p-4 max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <BigPreview smiles={debounced} />
            <div className="mt-2 text-[11px] font-mono text-slate-600 break-all">
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
function BigPreview({ smiles }: { smiles: string }) {
  const { data } = useQuery({
    queryKey: ["inspect-smiles", smiles, 600, 400],
    queryFn: () => api.inspectSmiles({ smiles, width: 600, height: 400 }),
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
