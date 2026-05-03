import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Icons";
import { api } from "../api";
import { tryReloadOnChunkError } from "../lib/chunkReload";

/**
 * Docked-pose 3D viewer for the compound editor's Quick dock result.
 *
 * Shows the cleaned WT receptor (from /structures/{pdb}/{chain}/WT) plus
 * the docked ligand pose (PDBQT text) in one 3Dmol scene. Supports a
 * minimal measure mode: click two atoms, get the distance.
 *
 * This is a slimmer cousin of MutationOverlayViewer — that one supports
 * full WT/mutant overlay with morph slider and ProLIF coloring, which
 * is overkill for a 280×280 viewer in the editor. The fullscreen 3D
 * overlay (which uses this same component at larger size) is where the
 * measure mode actually shines.
 *
 * Receptor fetch is keyed by `pdbId/chain/variant` so React re-renders
 * with a new prop trigger a fresh load. The receptor PDB is then cached
 * by the browser HTTP layer, so re-mounting on the same target after
 * tab switches is instant.
 */
interface Props {
  /** Resolved RCSB PDB id (e.g. "4OBE"). The catalog id ("kras") won't
   *  work here — Quick dock returns the resolved id explicitly so the
   *  caller already has it. */
  pdbId: string;
  chain: string;
  /** Variant code passed straight to /structures. "WT" for the wild-type
   *  receptor (always works), or e.g. "T790M" for a mutant cleaned PDB
   *  (works when that mutant has been built before for this PDB). */
  variant?: string;
  /** Docked ligand pose, PDBQT text. Empty string means the dock pipeline
   *  produced no parseable pose; the viewer renders just the receptor. */
  posePdbqt: string;
  /** Side length in pixels. The dashboard column passes ~210; the
   *  fullscreen overlay passes a much larger number. */
  size?: number;
  /** Optional pocket center to focus the camera on. When provided, the
   *  viewer zooms to a tight box around this point instead of fitting
   *  the whole receptor — much more useful since the compound editor
   *  cares about the binding site, not the entire kinase. */
  pocketCenter?: [number, number, number] | null;
}

// Measure-mode click radius (Å). 3Dmol's atom-pick is good but in a
// small viewport the user often clicks adjacent atoms; a generous
// threshold prevents misfires.
const MEASURE_PICK_RADIUS = 1.0;

export default function DockedPoseViewer({
  pdbId,
  chain,
  variant = "WT",
  posePdbqt,
  size = 210,
  pocketCenter = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receptorPdb, setReceptorPdb] = useState<string | null>(null);
  // Measure-mode state. When ON, every left-click on an atom records a
  // pick; after two picks we compute and display the distance (in Å)
  // and reset. Atom highlights are drawn as small spheres with a thin
  // dashed line; clearing the picks removes them.
  const [measureMode, setMeasureMode] = useState(false);
  const [measureDistance, setMeasureDistance] = useState<number | null>(null);
  const measurePicksRef = useRef<Array<{ x: number; y: number; z: number }>>([]);

  // Fetch the receptor PDB. The /structures endpoint hits the same
  // cleaned-receptor cache the docking pipeline uses, so this is cheap
  // (one round-trip, ~200KB-1MB depending on protein size).
  useEffect(() => {
    let cancelled = false;
    if (!pdbId || !chain) {
      setError("missing pdb_id or chain");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setReceptorPdb(null);
    api
      .structure(pdbId, chain, variant || "WT")
      .then((text) => {
        if (cancelled) return;
        if (!text || text.length < 100) {
          setError(`Receptor ${pdbId}/${chain}/${variant} returned empty`);
          setLoading(false);
          return;
        }
        setReceptorPdb(text);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(`Receptor fetch failed: ${e.message}`);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdbId, chain, variant]);

  // Mount the 3Dmol viewer ONCE the receptor is loaded. Each time the
  // receptor or pose changes we rebuild the scene from scratch — small
  // viewer, cheap to redraw.
  useEffect(() => {
    if (!receptorPdb || !containerRef.current) return;
    let cancelled = false;
    let viewer: any = null;
    (async () => {
      try {
        const mod: any = await import("3dmol");
        const $3Dmol: any =
          mod.default && Object.keys(mod.default).length > 0 ? mod.default : mod;
        if (cancelled || !containerRef.current) return;
        viewer = $3Dmol.createViewer(containerRef.current, {
          backgroundColor: "rgba(0,0,0,0)",
          antialias: true,
        });
        viewerRef.current = viewer;

        // Receptor — cartoon style, light gray. Good neutral backdrop
        // so the colorful ligand pops.
        viewer.addModel(receptorPdb, "pdb");
        viewer.setStyle({}, { cartoon: { color: "#94a3b8" } });

        // Docked ligand — element-colored sticks. Only added when the
        // pose PDBQT is non-empty (sometimes the pipeline produces a
        // valid score but no parseable pose, e.g. when the docking
        // engine returned a corrupt mode block).
        if (posePdbqt) {
          viewer.addModel(posePdbqt, "pdbqt");
          // Find the just-added model index so we style only the ligand,
          // not the receptor. 3Dmol's setStyle takes a selection spec;
          // model-1 is the receptor (index 0), model-2 is the ligand.
          viewer.setStyle({ model: 1 }, { stick: { radius: 0.18, colorscheme: "default" } });
        }

        // Camera focus — if a pocket center is provided, zoom there
        // tightly. Otherwise fit the whole receptor (less useful for
        // a small viewer but better than nothing).
        if (pocketCenter) {
          viewer.zoomTo({ resn: "_pocket_focus_" });  // empty selection → no-op
          viewer.center({ x: pocketCenter[0], y: pocketCenter[1], z: pocketCenter[2] });
          viewer.zoom(1.5, 0);
        } else {
          viewer.zoomTo();
        }

        viewer.render();
        setLoading(false);
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        if (tryReloadOnChunkError(msg)) return;
        if (!cancelled) {
          setError(`3D viewer failed to load: ${msg}`);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        if (viewer && typeof viewer.removeAllModels === "function") {
          viewer.removeAllModels();
        }
        viewerRef.current = null;
      } catch { /* ignore */ }
    };
  }, [receptorPdb, posePdbqt, pocketCenter]);

  // Wire/unwire measure-mode click handler. When active, clicking an
  // atom adds a pick; after the second pick we draw a dashed line
  // between them with the distance label and reset for the next pair.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || typeof viewer.setClickable !== "function") return;
    if (!measureMode) {
      // Clear any pending picks + highlight shapes when leaving measure
      // mode so the next entry starts clean.
      measurePicksRef.current = [];
      try {
        viewer.removeAllShapes();
        viewer.render();
      } catch { /* ignore */ }
      return;
    }
    const onClick = (atom: any) => {
      if (!atom) return;
      const point = { x: atom.x, y: atom.y, z: atom.z };
      measurePicksRef.current.push(point);
      try {
        viewer.addSphere({
          center: point,
          radius: 0.4,
          color: "#f97316",  // orange — visible against most backgrounds
        });
        if (measurePicksRef.current.length === 2) {
          const [a, b] = measurePicksRef.current;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          setMeasureDistance(dist);
          // Draw a dashed line between the two picks with the distance
          // label at the midpoint. addCylinder with dashedLine isn't
          // supported in all 3Dmol versions, so use addLine + addLabel.
          viewer.addLine({ start: a, end: b, dashed: true, color: "#f97316" });
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
          viewer.addLabel(`${dist.toFixed(2)} Å`, {
            position: mid,
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            backgroundOpacity: 0.85,
            fontColor: "white",
            fontSize: 12,
            borderThickness: 0,
            inFront: true,
          });
          // Reset for the next pair on the next click.
          measurePicksRef.current = [];
        }
        viewer.render();
      } catch { /* ignore — defensive against 3Dmol API quirks */ }
    };
    try {
      viewer.setClickable({}, true, onClick);
    } catch { /* ignore */ }
    return () => {
      try {
        viewer.setClickable({}, false, null);
      } catch { /* ignore */ }
    };
  }, [measureMode]);

  return (
    <div className="space-y-1.5 flex flex-col h-full">
      <div
        className="relative rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 overflow-hidden"
        style={{ width: size, height: size }}
      >
        <div ref={containerRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-slate-900/40 pointer-events-none">
            <Spinner size={14} />
          </div>
        )}
        {error && !loading && (
          <div
            className="absolute inset-0 flex items-center justify-center text-center px-2 text-[10px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 leading-tight"
            title={error}
          >
            {error}
          </div>
        )}
      </div>
      {/* Measure-mode toggle + result. Clicking enables measure mode;
          subsequent clicks on atoms record picks. The distance label
          shows the most recent pair. Clear button resets shapes. */}
      <div className="flex items-center gap-2 text-[10px]">
        <button
          type="button"
          onClick={() => setMeasureMode((v) => !v)}
          className={
            "px-1.5 py-0.5 rounded border transition-colors " +
            (measureMode
              ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300 dark:hover:bg-slate-700/50")
          }
          title={measureMode ? "Exit measure mode (click toggle again)" : "Click two atoms to measure their distance"}
        >
          {measureMode ? "📏 Measuring (click 2 atoms)" : "📏 Measure"}
        </button>
        {measureDistance !== null && (
          <span className="text-amber-700 dark:text-amber-300 font-semibold">
            {measureDistance.toFixed(2)} Å
          </span>
        )}
        {posePdbqt === "" && (
          <span className="ml-auto text-slate-400 dark:text-slate-500" title="The docking pipeline returned a score but no parseable pose. Re-dock to retry.">
            (pose missing)
          </span>
        )}
      </div>
      {/* Suppress lint warning for MEASURE_PICK_RADIUS — kept for the
          future 'snap to nearest atom' enhancement. */}
      {false && <span style={{ display: "none" }}>{MEASURE_PICK_RADIUS}</span>}
    </div>
  );
}
