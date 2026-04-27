import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Icons";

interface Props {
  pdbId: string;
  chain?: string;
  /** Residue numbers to highlight (e.g. mutation site) */
  highlightResidues?: number[];
  /** Pocket box centre [x,y,z] in Å — drawn as a translucent sphere */
  pocketCenter?: [number, number, number];
  pocketRadius?: number;
  className?: string;
}

/** Atom shape we get back from 3Dmol's click callback. The full type is
 *  bigger but we only ever read coords + identifiers. */
type Atom3DMol = {
  x: number; y: number; z: number;
  resn?: string; resi?: number; chain?: string;
  atom?: string; serial?: number;
  // Used as a unique key for highlighting + pair detection
  index: number;
};

/**
 * 3D protein viewer powered by 3Dmol.js.
 *
 * Lazy-loaded — the 3dmol library only loads when this component actually mounts.
 * Loads structures directly from RCSB by PDB ID. No backend round-trip needed.
 */
export default function StructureViewer({
  pdbId,
  chain,
  highlightResidues = [],
  pocketCenter,
  pocketRadius = 8,
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [atomCount, setAtomCount] = useState<number | null>(null);

  // ── Measure-mode state ──────────────────────────────────────────────
  // Holds the 3Dmol viewer instance so the measure UI (separate from the
  // load effect) can manipulate it without re-creating the viewer.
  const viewerRef = useRef<any>(null);
  const [measureMode, setMeasureMode] = useState(false);
  // First atom of an in-progress measurement. When the user clicks a 2nd
  // atom we draw the line + label and reset this back to null so the next
  // click starts a fresh measurement.
  const firstAtomRef = useRef<Atom3DMol | null>(null);
  // Shape handles for everything we've drawn — used to clear them when the
  // user toggles measure mode off or switches PDB.
  const measureShapesRef = useRef<{ shapes: any[]; labels: any[] }>({ shapes: [], labels: [] });
  const [measurements, setMeasurements] = useState<
    { id: number; label: string; distance: number }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    let viewer: any = null;
    let resizeObserver: ResizeObserver | null = null;

    async function load() {
      if (!containerRef.current) return;
      setLoading(true);
      setError(null);
      setAtomCount(null);

      try {
        // 3dmol's ES module export shape varies — normalize to a single namespace
        const mod: any = await import("3dmol");
        const $3Dmol: any = mod.default && Object.keys(mod.default).length > 0 ? mod.default : mod;

        if (cancelled || !containerRef.current) return;

        // Ensure container has measured dimensions before initializing — 3Dmol
        // grabs them at create time and won't pick up later size changes
        // unless we explicitly resize().
        const container = containerRef.current;

        viewer = $3Dmol.createViewer(container, {
          backgroundColor: "white",
          antialias: true,
        });
        // Make the viewer reachable from the measure-mode UI below.
        viewerRef.current = viewer;

        // Fetch the PDB ourselves (more reliable than $3Dmol.download under HMR)
        const resp = await fetch(`https://files.rcsb.org/download/${pdbId}.pdb`);
        if (!resp.ok) throw new Error(`PDB ${pdbId} fetch failed (HTTP ${resp.status})`);
        const pdbText = await resp.text();
        if (cancelled) return;

        const model = viewer.addModel(pdbText, "pdb");
        const numAtoms = model.selectedAtoms({}).length;
        setAtomCount(numAtoms);

        if (numAtoms === 0) {
          throw new Error("Model loaded with 0 atoms");
        }

        // Cartoon for protein, lines for any non-protein atoms (just in case).
        // Don't filter by chain in setStyle — render everything; some PDBs use
        // unexpected chain IDs that silently select nothing.
        viewer.setStyle({}, { cartoon: { color: "spectrum" } });

        // Highlight requested residues — try with and without chain filter
        if (highlightResidues.length > 0) {
          const sel: any = { resi: highlightResidues };
          if (chain) sel.chain = chain;
          viewer.setStyle(sel, {
            cartoon: { color: "spectrum" },
            stick: { color: "#3b6cf6", radius: 0.3 },
          });
        }

        // Pocket sphere
        if (pocketCenter) {
          viewer.addSphere({
            center: { x: pocketCenter[0], y: pocketCenter[1], z: pocketCenter[2] },
            radius: pocketRadius,
            color: "#14b8a6",
            opacity: 0.18,
          });
        }

        // CRITICAL: zoom and render after geometry is in place.
        // zoomTo() with no args fits all atoms — safer than aiming at a coord
        // that might be far from the actual model.
        viewer.zoomTo();
        viewer.render();
        viewer.resize();   // pick up any final layout changes

        // Repaint on container size changes (sidebar collapse, window resize, etc.)
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            try { viewer.resize(); viewer.render(); } catch { /* ignore */ }
          });
          resizeObserver.observe(container);
        }

        if (!cancelled) setLoading(false);
      } catch (e) {
        console.error("StructureViewer error:", e);
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (viewer) {
        try { viewer.clear(); } catch { /* ignore */ }
      }
      // Reset all measurement state when the structure changes — drawn shapes
      // and labels live on the old viewer, so they're already gone.
      viewerRef.current = null;
      firstAtomRef.current = null;
      measureShapesRef.current = { shapes: [], labels: [] };
      setMeasurements([]);
      setMeasureMode(false);
    };
  }, [pdbId, chain, JSON.stringify(highlightResidues), JSON.stringify(pocketCenter), pocketRadius]);

  // ── Measure-mode wiring ─────────────────────────────────────────────
  // Toggling the mode rebinds atom-click handlers. Ordinary mode = no
  // click handlers (don't interfere with rotate/pan/zoom). Measure mode =
  // every atom is clickable; clicking two atoms draws a labeled line
  // between them with the inter-atomic distance in Å.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (measureMode) {
      const onAtomClick = (atom: Atom3DMol) => {
        if (!atom || typeof atom.x !== "number") return;
        if (!firstAtomRef.current) {
          firstAtomRef.current = atom;
          // Mark the first atom with a small sphere highlight so the user
          // can tell their click registered.
          const handle = viewer.addSphere({
            center: { x: atom.x, y: atom.y, z: atom.z },
            radius: 0.45,
            color: "#f59e0b",
            opacity: 0.95,
          });
          measureShapesRef.current.shapes.push(handle);
          viewer.render();
          return;
        }

        const a = firstAtomRef.current;
        const b = atom;
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Cylinder = line; addLabel pinned at the midpoint.
        const cyl = viewer.addCylinder({
          start: { x: a.x, y: a.y, z: a.z },
          end:   { x: b.x, y: b.y, z: b.z },
          radius: 0.06,
          color: "#f59e0b",
          dashed: true,
        });
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        const lbl = viewer.addLabel(`${dist.toFixed(2)} Å`, {
          position: mid,
          backgroundColor: "#0f172a",
          backgroundOpacity: 0.85,
          fontColor: "#fbbf24",
          fontSize: 12,
          borderThickness: 0,
          inFront: true,
        });
        // Sphere on second atom too so both endpoints look anchored.
        const sphereB = viewer.addSphere({
          center: { x: b.x, y: b.y, z: b.z },
          radius: 0.45,
          color: "#f59e0b",
          opacity: 0.95,
        });

        measureShapesRef.current.shapes.push(cyl, sphereB);
        measureShapesRef.current.labels.push(lbl);

        // Human-readable label for the side panel
        const fmtAtom = (x: Atom3DMol) =>
          `${x.resn ?? "?"}${x.resi ?? ""}${x.chain ? `.${x.chain}` : ""}/${x.atom ?? "?"}`;
        setMeasurements((prev) => [
          ...prev,
          { id: Date.now() + Math.random(), label: `${fmtAtom(a)} ↔ ${fmtAtom(b)}`, distance: dist },
        ]);

        firstAtomRef.current = null;
        viewer.render();
      };

      // Make every atom in the model clickable. 3Dmol stores the callback
      // per atom, so a wide selection means any atom click fires it.
      try {
        viewer.setClickable({}, true, onAtomClick);
        viewer.render();
      } catch (e) {
        // Some 3Dmol builds renamed setClickable args — best-effort.
        console.warn("measure mode: setClickable failed", e);
      }
    } else {
      // Leaving measure mode: clear the in-progress first-atom highlight,
      // remove drawn shapes/labels, and detach click handlers.
      try {
        for (const s of measureShapesRef.current.shapes) viewer.removeShape(s);
        for (const l of measureShapesRef.current.labels) viewer.removeLabel(l);
      } catch { /* ignore */ }
      measureShapesRef.current = { shapes: [], labels: [] };
      firstAtomRef.current = null;
      try { viewer.setClickable({}, false, () => {}); } catch { /* ignore */ }
      viewer.render();
      setMeasurements([]);
    }
  }, [measureMode]);

  return (
    <div className={`relative rounded-lg overflow-hidden border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 ${className}`}>
      <div ref={containerRef} className="w-full h-full relative" style={{ minHeight: 240, position: "relative" }} />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 text-slate-500 dark:bg-slate-900/80 dark:text-slate-400 pointer-events-none">
          <Spinner size={20} />
          <p className="text-xs mt-2">Loading {pdbId}…</p>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-rose-50/95 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200 text-xs p-4 text-center">
          <p className="font-semibold mb-1">Couldn't load structure</p>
          <p className="text-[11px]">{error}</p>
        </div>
      )}
      {!loading && !error && (
        <div className="absolute bottom-2 right-2 text-[10px] text-slate-400 bg-white/80 dark:text-slate-300 dark:bg-slate-800/80 px-1.5 py-0.5 rounded pointer-events-none">
          {pdbId}{atomCount != null && ` · ${atomCount} atoms`} · drag to rotate
        </div>
      )}

      {/* Measure-mode toggle — top-right corner. Hidden until the structure
          loads so the button doesn't sit over the spinner. */}
      {!loading && !error && (
        <button
          type="button"
          onClick={() => setMeasureMode((m) => !m)}
          aria-pressed={measureMode}
          title={measureMode
            ? "Click two atoms to measure. Click here to exit."
            : "Distance measure: click to enable, then click two atoms."
          }
          className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-1 rounded shadow-sm ring-1 transition-colors ${
            measureMode
              ? "bg-amber-500 text-white ring-amber-600"
              : "bg-white/90 text-slate-700 ring-slate-200 hover:bg-amber-50 hover:text-amber-700 dark:bg-slate-800/90 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-amber-900/40 dark:hover:text-amber-200"
          }`}
        >
          {measureMode ? "✕ Measuring" : "📏 Measure"}
        </button>
      )}

      {/* Live readout of measurements taken in this session. Stacks at the
          top-left so it doesn't fight the bottom-right info chip or the
          measure button. Clears when measure mode is toggled off. */}
      {measureMode && measurements.length > 0 && (
        <div className="absolute top-2 left-2 max-w-[55%] text-[10px] font-mono bg-slate-900/85 text-amber-200 rounded px-2 py-1.5 shadow ring-1 ring-amber-500/30 pointer-events-none">
          {measurements.slice(-5).map((m) => (
            <div key={m.id} className="truncate">
              <span className="text-amber-400 font-semibold">{m.distance.toFixed(2)} Å</span>
              <span className="text-slate-300 ml-2">{m.label}</span>
            </div>
          ))}
          {measurements.length > 5 && (
            <div className="text-slate-400 italic">…{measurements.length - 5} earlier</div>
          )}
        </div>
      )}

      {/* In-progress measurement hint — shown after the first click while we
          wait for the second. Helps users understand they're mid-action. */}
      {measureMode && firstAtomRef.current && (
        <div className="absolute bottom-2 left-2 text-[10px] text-amber-700 bg-amber-50/95 dark:bg-amber-900/60 dark:text-amber-200 px-2 py-1 rounded ring-1 ring-amber-300/60">
          Pick the second atom…
        </div>
      )}
    </div>
  );
}
