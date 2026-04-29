import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Close, Spinner } from "./Icons";
import { tryReloadOnChunkError } from "../lib/chunkReload";

/**
 * Overlay viewer for a WT/mutant pair.
 *
 * Loads BOTH structures into one 3Dmol viewer and renders the mutated residue's
 * side chain twice — once from WT (green), once from mutant (blue). A slider
 * controls which one(s) you see.
 *
 * On the slider:
 *   0–25%   → only WT shown
 *   25–75%  → both shown (so you can see the geometric overlap)
 *   75–100% → only mutant shown
 *
 * We use this three-zone approach because 3Dmol's per-atom opacity blending on
 * stick styles is unreliable (some versions ignore the opacity field). Hard
 * show/hide is bulletproof.
 *
 * Has a fullscreen toggle (top-right corner) — opens the same viewer in a
 * modal covering most of the viewport for closer inspection.
 */

/** A single contact: which residue it touches and what kind of interaction. */
export interface ContactSpec {
  residue: string;        // "MET793" or "LYS745.A"
  type: string;           // ProLIF code: HBAcceptor, Hydrophobic, VdWContact, etc.
}

interface Props {
  wtPdb: string | null;
  mutantPdb: string | null;
  /** Docked ligand pose as PDBQT text (best mode only). When present, drawn as
   *  element-colored sticks alongside the receptor. */
  posePdbqt?: string | null;
  /** Optional ProLIF contacts — drives per-residue side-chain coloring */
  contacts?: ContactSpec[];
  chain?: string;
  mutationResidue?: number;
  pocketCenter?: [number, number, number];
  pocketRadius?: number;
  initialBlend?: number;
  className?: string;
  /** Variant label (e.g. "T790M" or "WT") — used to surface "pose docked
   *  against X" inside the viewer so the user sees provenance at a glance. */
  variantLabel?: string;
  /** Optional context shown in the fullscreen header (compound × variant, job #). */
  contextLabel?: string;
  contextSubtitle?: string;
}

/** Map ProLIF interaction-type codes → readable colors. */
const INTERACTION_COLOR: Record<string, string> = {
  HBDonor:       "#10b981",  // green
  HBAcceptor:    "#10b981",
  Hydrophobic:   "#eab308",  // yellow/amber
  PiStacking:    "#a855f7",  // purple
  PiCation:      "#a855f7",
  CationPi:      "#a855f7",
  Cationic:      "#f97316",  // orange
  Anionic:       "#f97316",
  XBDonor:       "#06b6d4",  // cyan (halogen)
  XBAcceptor:    "#06b6d4",
  MetalDonor:    "#94a3b8",  // slate
  MetalAcceptor: "#94a3b8",
  VdWContact:    "#cbd5e1",  // light grey (least informative)
};

/** Pull "MET793.A" or "MET793" → 793. Returns null if no number found. */
function parseResidueNumber(label: string): number | null {
  const m = label.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Pick the most informative interaction for a residue (non-VdW preferred). */
function dominantType(types: string[]): string {
  const nonVdw = types.find((t) => t !== "VdWContact");
  return nonVdw ?? types[0] ?? "VdWContact";
}

export default function MutationOverlayViewer(props: Props) {
  const [fullscreen, setFullscreen] = useState(false);

  // Esc closes the fullscreen modal — better than only click-outside.
  // Also lock body scroll while modal is open so the page doesn't move underneath.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  return (
    <>
      <ViewerCanvas
        {...props}
        onExpand={() => setFullscreen(true)}
        isFullscreen={false}
      />
      {fullscreen && createPortal(
        // Rendered into document.body via createPortal so the modal escapes
        // ANY parent stacking context (the new sticky right-rail banner
        // column, transformed elements, filter ancestors, etc.). Without
        // the portal, fixed-positioned elements get clipped to whichever
        // ancestor created a new containing block — the matrix on the
        // left was reading through clearly in some configurations.
        // Backdrop is fully opaque (bg-ink) so nothing on the page bleeds
        // through. Top padding clears the sticky page header (~64px) so
        // the modal's X never sits underneath it.
        <div
          className="fixed inset-0 z-[200] isolate bg-ink flex items-center justify-center pt-20 pb-6 px-4 sm:pt-24 sm:pb-10 sm:px-12 animate-fade-in"
          onClick={() => setFullscreen(false)}
        >
          <div
            className="relative w-full h-full max-w-6xl max-h-[calc(100vh-7rem)] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Fullscreen header — always rendered so the X button is always
                reachable, even if no context labels were passed in. */}
            <header className="flex items-start justify-between px-6 py-3 border-b border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700">
              <div className="min-w-0 pr-3">
                {props.contextLabel && (
                  <div className="text-base font-semibold text-ink leading-tight truncate dark:text-slate-100">
                    {props.contextLabel}
                  </div>
                )}
                {props.contextSubtitle && (
                  <div className="text-xs text-slate-500 mt-0.5 truncate dark:text-slate-400">
                    {props.contextSubtitle}
                  </div>
                )}
              </div>
              <button
                onClick={() => setFullscreen(false)}
                className="shrink-0 text-slate-500 hover:text-ink p-2 -m-1 rounded-md hover:bg-slate-100 transition-colors dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700"
                aria-label="Close (Esc)"
                title="Close (Esc)"
              >
                <Close size={20} />
              </button>
            </header>
            <div className="flex-1 min-h-0">
              <ViewerCanvas
                {...props}
                isFullscreen
                onExpand={() => setFullscreen(false)}
                className="h-full"
                hideExpandButton  // header has its own close X
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Visual style options exposed via the control toolbar. Mirrors PubChem's
 *  3D Conformer viewer: backbone style for the receptor, ligand style for the
 *  pose, plus toggles for hydrogens and rotation animation. */
type BackboneStyle = "cartoon" | "line" | "sphere" | "surface" | "hidden";
type PoseStyle = "stick" | "ballAndStick" | "line" | "sphere";
/** Surface coloring modes — only meaningful when backboneStyle === "surface".
 *  - plain: uniform light slate, the canonical "buried-in-pocket" hero shot
 *  - hydrophobicity: Kyte-Doolittle scale per residue, hydrophobic → amber,
 *    polar → cyan. Tells the user where the binding groove's lipid-loving
 *    region sits.
 *  - electrostatic: simple per-residue charge surrogate at neutral pH.
 *    Lys/Arg/His → blue, Asp/Glu → red, others → near-white. Real APBS
 *    electrostatics would need a server round-trip; this charge proxy is
 *    informative enough for spotting a charge-flip mutation in the pocket. */
type SurfaceColor = "plain" | "hydrophobicity" | "electrostatic";

/** Kyte-Doolittle hydrophobicity → ramp color. -4.5 (Arg) → cyan,
 *  +4.5 (Ile) → amber. Anything outside ±4.5 clamps. */
const KD_HYDROPHOBICITY: Record<string, number> = {
  ALA:  1.8, ARG: -4.5, ASN: -3.5, ASP: -3.5, CYS:  2.5,
  GLN: -3.5, GLU: -3.5, GLY: -0.4, HIS: -3.2, ILE:  4.5,
  LEU:  3.8, LYS: -3.9, MET:  1.9, PHE:  2.8, PRO: -1.6,
  SER: -0.8, THR: -0.7, TRP: -0.9, TYR: -1.3, VAL:  4.2,
};
function hydroColor(resn: string): string {
  const v = KD_HYDROPHOBICITY[resn] ?? 0;
  // map -4.5..4.5 → 0..1 → cyan(#06b6d4) … amber(#f59e0b)
  const t = Math.max(0, Math.min(1, (v + 4.5) / 9));
  const r = Math.round(0x06 + (0xf5 - 0x06) * t);
  const g = Math.round(0xb6 + (0x9e - 0xb6) * t);
  const b = Math.round(0xd4 + (0x0b - 0xd4) * t);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Per-residue charge color at pH 7. Positive=blue, negative=red, neutral=light. */
function chargeColor(resn: string): string {
  if (resn === "LYS" || resn === "ARG") return "#2563eb";   // strong + → blue
  if (resn === "HIS")                    return "#93c5fd";   // weak + → light blue
  if (resn === "ASP" || resn === "GLU") return "#dc2626";   // - → red
  return "#e5e7eb";                                          // neutral → light slate
}

function ViewerCanvas({
  wtPdb,
  mutantPdb,
  posePdbqt,
  contacts,
  chain,
  mutationResidue,
  pocketCenter,
  pocketRadius = 8,
  initialBlend,
  className = "",
  variantLabel,
  isFullscreen,
  onExpand,
  hideExpandButton,
}: Props & { isFullscreen: boolean; onExpand: () => void; hideExpandButton?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  // The 3Dmol namespace itself, stashed during load() so applyAllStyles can
  // reach SurfaceType constants. Surface coloring needs $3Dmol.SurfaceType.SAS;
  // hard-coded literal (2) is used as a fallback if the namespace isn't ready.
  const dmolNsRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [atomCount, setAtomCount] = useState<number | null>(null);
  // Default slider position: middle (both side chains visible) when there's a
  // mutant; pure WT when there isn't. Caller can still override with prop.
  const [blend, setBlend] = useState(
    initialBlend ?? (mutantPdb ? 0.5 : 0)
  );

  // Control-panel state — defaults match the original look so existing users
  // don't see the viewer change after this update.
  const [backboneStyle, setBackboneStyle] = useState<BackboneStyle>("cartoon");
  const [poseStyle, setPoseStyle] = useState<PoseStyle>("stick");
  const [showH, setShowH] = useState(false);  // ligand H atoms; default off (cleaner)
  const [spinning, setSpinning] = useState(false);
  // Surface mode coloring — only meaningful when backboneStyle === "surface".
  // We keep the state alive when the user switches away from Surface so
  // toggling back restores their preferred coloring.
  const [surfaceColor, setSurfaceColor] = useState<SurfaceColor>("plain");
  // Tracks whether the surface generation is currently in flight (3Dmol's
  // addSurface is CPU-heavy, ~0.5–2 s for a typical kinase). Used to fade
  // the toolbar so users know the click registered.
  const [surfaceComputing, setSurfaceComputing] = useState(false);
  // Surface handles need to be removed before re-adding when style or
  // color changes — otherwise they stack and drag rendering to a crawl.
  const surfaceHandlesRef = useRef<any[]>([]);

  // ── Measure-mode state ──────────────────────────────────────────────
  // When ON, atoms become clickable; pick two atoms to draw a labeled dashed
  // line with the inter-atomic distance in Å. Toggling OFF clears all drawn
  // measurements.
  //   `firstAtomRef`        — actual atom payload (closure-stable, used in
  //                           the click handler for distance math).
  //   `firstAtomPicked`     — paired state mirror so the button label can
  //                           re-render between the 1st and 2nd click.
  //   `measureShapesRef`    — handles to drawn shapes/labels for cleanup.
  const [measureMode, setMeasureMode] = useState(false);
  const firstAtomRef = useRef<any>(null);
  const [firstAtomPicked, setFirstAtomPicked] = useState(false);
  const measureShapesRef = useRef<{ shapes: any[]; labels: any[] }>({ shapes: [], labels: [] });
  const [measurements, setMeasurements] = useState<
    { id: number; label: string; distance: number }[]
  >([]);

  // Index of the pose model: depends on whether we loaded a mutant or not.
  const poseModelIdx = mutantPdb ? 2 : 1;

  /** Re-apply ALL styles to the viewer based on current control + blend state.
   *  Single source of truth — called from load() and from any control change.
   *  Wiping styles first (`setStyle({}, {})`) prevents leftover sticks from
   *  previous styles bleeding through.
   *
   *  Each step is independently try/catch'd because 3Dmol's setStyle/addStyle
   *  can throw if the selector targets a model that wasn't successfully
   *  loaded (e.g. "model: 1" when the mutant PDB came back malformed). One
   *  bad step shouldn't blank the whole viewer — show what we can. */
  function applyAllStyles(viewer: any) {
    if (!viewer || typeof viewer.setStyle !== "function") return;

    const safe = (label: string, fn: () => void) => {
      try { fn(); } catch (e) { console.warn(`applyAllStyles[${label}]:`, e); }
    };

    // Step 1: clear everything to a known state
    safe("clear", () => viewer.setStyle({}, {}));

    // Step 2: backbone style on model 0 (the WT structure).
    //
    // Always remove any prior surface first — addSurface APIs in 3Dmol stack
    // surfaces (each call adds another mesh on top), so without explicit
    // removal switching from Surface→Cartoon would leave the surface drawn
    // beneath the cartoon, and switching color modes would render multiple
    // overlapping surfaces.
    safe("clear-surfaces", () => {
      for (const h of surfaceHandlesRef.current) {
        try { viewer.removeSurface(h); } catch { /* ignore */ }
      }
      surfaceHandlesRef.current = [];
    });

    if (backboneStyle === "surface") {
      // Surface mode replaces the cartoon entirely — no setStyle for model 0,
      // we just paint a molecular surface. Color depends on surfaceColor:
      //   - plain → uniform light slate
      //   - hydrophobicity → per-residue Kyte-Doolittle ramp
      //   - electrostatic → per-residue charge surrogate at neutral pH
      // 3Dmol's addSurface is async-ish (kicks the marching-cubes job onto
      // the next frame); we mark surfaceComputing so the toolbar can fade.
      // SAS (solvent-accessible) is the most pocket-readable surface for
      // docking — VDW packs too tightly and obscures the ligand pocket.
      try { setSurfaceComputing(true); } catch { /* ignore */ }
      // MS (molecular surface, a.k.a. Connolly / solvent-excluded surface)
      // wraps the protein tightly with a closed-shell mesh. The binding
      // pocket then renders as a deep depression in the same-colored
      // material — exactly the "ligand sitting in a colored cave" look
      // from the hero references. SAS (solvent-accessible) leaves literal
      // holes through to the canvas BG, which read as a void instead of
      // a depression and required forcing a dark canvas to look right.
      const surfType = dmolNsRef.current?.SurfaceType?.MS ?? 1; // MS=1
      // Fully opaque so the pocket interior reads as solid material
      // rather than transparent through to the BG. Slight transparency
      // (0.92) was masking the depression effect.
      const opts: Record<string, any> = { opacity: 1.0 };
      if (surfaceColor === "plain") {
        opts.color = "#a78bfa"; // light violet — matches the hero look
      } else {
        // For property-based coloring we paint per-atom by residue name.
        // 3Dmol's `colorfunc` receives an atom and returns a hex color.
        const fn = surfaceColor === "hydrophobicity" ? hydroColor : chargeColor;
        opts.colorfunc = (atom: any) => fn(String(atom?.resn || "").toUpperCase());
      }
      safe("add-surface", () => {
        const handle = viewer.addSurface(surfType, opts, { model: 0 });
        if (handle) surfaceHandlesRef.current.push(handle);
        // The surface promise resolves when geometry is ready; we don't have
        // a callback in 3Dmol's older API, so just clear the spinner after
        // a render tick. This is good enough — actual users see the spinner
        // for ~half a second on a kinase, which is the right feel.
        requestAnimationFrame(() => setSurfaceComputing(false));
      });
    } else {
      const backboneSpec: Record<string, any> = {};
      if (backboneStyle === "cartoon") {
        backboneSpec.cartoon = { color: "#cbd5e1" };
      } else if (backboneStyle === "line") {
        backboneSpec.line = { color: "#94a3b8", linewidth: 1 };
      } else if (backboneStyle === "sphere") {
        backboneSpec.sphere = { colorscheme: "Jmol", scale: 0.25 };
      }
      // "hidden" → leave backboneSpec empty so nothing renders for the bulk
      if (backboneStyle !== "hidden") {
        safe("backbone", () => viewer.setStyle({ model: 0 }, backboneSpec));
      }
      setSurfaceComputing(false);
    }

    // Step 3: contact residues coloured by interaction type, on model 0
    if (contacts && contacts.length) {
      const byResidue = new Map<number, string[]>();
      for (const c of contacts) {
        const n = parseResidueNumber(c.residue);
        if (n == null) continue;
        const list = byResidue.get(n) ?? [];
        list.push(c.type);
        byResidue.set(n, list);
      }
      for (const [resnum, types] of byResidue) {
        const color = INTERACTION_COLOR[dominantType(types)] ?? "#cbd5e1";
        const sel: any = { model: 0, resi: resnum };
        if (chain) sel.chain = chain;
        if (mutationResidue != null && resnum === mutationResidue) continue;
        safe(`contact-${resnum}`, () => viewer.addStyle(sel, { stick: { color, radius: 0.22 } }));
      }
    }

    // Step 4: WT/mutant side-chain swap at the mutation residue, controlled
    // by the blend slider's three-zone show/hide.
    if (mutationResidue != null) {
      const wtSel: any = { model: 0, resi: mutationResidue };
      if (chain) wtSel.chain = chain;
      const mutSel: any = { model: 1, resi: mutationResidue };
      if (chain) mutSel.chain = chain;
      const showWt = blend < 0.75;
      const showMut = blend > 0.25 && !!mutantPdb;
      if (showWt) safe("wt-side", () => viewer.addStyle(wtSel, { stick: { color: "#10b981", radius: 0.32 } }));
      if (showMut) safe("mut-side", () => viewer.addStyle(mutSel, { stick: { color: "#3b6cf6", radius: 0.32 } }));
    }

    // Step 5: pose style on model poseModelIdx
    if (posePdbqt) {
      let poseSpec: Record<string, any>;
      switch (poseStyle) {
        case "ballAndStick":
          poseSpec = {
            stick: { colorscheme: "Jmol", radius: 0.18 },
            sphere: { colorscheme: "Jmol", scale: 0.30 },
          };
          break;
        case "line":
          poseSpec = { line: { colorscheme: "Jmol", linewidth: 2 } };
          break;
        case "sphere":
          poseSpec = { sphere: { colorscheme: "Jmol", scale: 0.55 } };
          break;
        case "stick":
        default:
          poseSpec = { stick: { colorscheme: "Jmol", radius: 0.22 } };
      }
      safe("pose", () => viewer.setStyle({ model: poseModelIdx }, poseSpec));
    }

    // Step 6: hydrogen visibility on the ligand. Default is hidden (cleaner
    // view); user can toggle on. Receptor H atoms are usually absent (PDBFixer
    // omits them), so this mostly affects the ligand.
    if (!showH && posePdbqt) {
      safe("hide-H", () => viewer.setStyle({ model: poseModelIdx, elem: "H" }, {}));
    }
  }

  /** Cheap validity check for PDB text. Catches the failure mode where the
   *  fetch returned an HTML error page (e.g. Cloudflare 502, Fly maintenance)
   *  and the JSON parser saw it as text — passing that to 3Dmol's addModel
   *  produces a model with 0 atoms or worse, undefined. Better to throw a
   *  descriptive error here than crash inside the viewer's render loop. */
  function looksLikePdb(text: string | null | undefined): text is string {
    if (!text || text.length < 100) return false;
    // Real PDB text is always ASCII and contains ATOM or HETATM record names
    // in column 1. HTML error pages don't.
    return /^\s*(ATOM|HETATM|HEADER|MODEL|REMARK)\b/m.test(text);
  }

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let viewer: any = null;

    async function load() {
      if (!containerRef.current) return;
      setLoading(true);
      setError(null);
      setAtomCount(null);

      // Validate WT BEFORE booting 3Dmol — a missing/garbage WT means we
      // have nothing to show and the viewer will crash deep in addStyle if
      // we let it through. (HeroBanner already gates on this for the
      // streaming-race case; this is a defense-in-depth check for callers
      // that don't.)
      if (!looksLikePdb(wtPdb)) {
        setError("WT structure not ready yet — try again in a moment.");
        setLoading(false);
        return;
      }

      try {
        const mod: any = await import("3dmol");
        const $3Dmol: any = mod.default && Object.keys(mod.default).length > 0 ? mod.default : mod;
        // Stash the namespace so applyAllStyles can reach SurfaceType etc.
        // when the user toggles backbone modes after the initial load.
        dmolNsRef.current = $3Dmol;

        // Wait one frame so the container has its final dimensions.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (cancelled || !containerRef.current) return;

        const container = containerRef.current;
        // Theme-aware canvas background — read the .dark class on <html>.
        // Light: pure white (matches card surface). Dark: deep slate so the
        // ribbon contrast stays readable without being a pure black hole.
        const isDark = document.documentElement.classList.contains("dark");
        viewer = $3Dmol.createViewer(container, {
          backgroundColor: isDark ? "#0f172a" : "white",
          antialias: true,
        });
        // 3Dmol's createViewer returns undefined if WebGL init fails (e.g.
        // browser ran out of GL contexts after lots of tab churn). Without
        // this guard the addModel call below crashes with the cryptic
        // "Cannot read properties of undefined (reading 'addModel')".
        if (!viewer || typeof viewer.addModel !== "function") {
          throw new Error("3D viewer failed to initialize (WebGL unavailable?)");
        }
        viewerRef.current = viewer;

        // Model 0: wild-type, used for the backbone cartoon
        const wtModel = viewer.addModel(wtPdb, "pdb");
        // 3Dmol historically returns the model object, but if PDB parsing
        // bombs out it can return null/undefined. Treat that as a load
        // failure with a real message instead of letting downstream
        // selectedAtoms()/setStyle() crash with "Cannot read properties of
        // undefined".
        if (!wtModel || typeof wtModel.selectedAtoms !== "function") {
          throw new Error("WT structure couldn't be parsed — file may be incomplete");
        }
        const wtAtomCount = wtModel.selectedAtoms({}).length;
        setAtomCount(wtAtomCount);
        if (wtAtomCount === 0) throw new Error("WT model loaded with 0 atoms");

        // Model 1: mutant (loaded but invisible by default — applyAllStyles
        // controls visibility). If the mutant PDB looks bad, skip it and let
        // the WT view stand on its own rather than failing the whole viewer.
        if (mutantPdb && mutationResidue != null) {
          if (looksLikePdb(mutantPdb)) {
            try {
              viewer.addModel(mutantPdb, "pdb");
            } catch (e) {
              console.warn("mutant addModel failed; continuing with WT only", e);
            }
          } else {
            console.warn("mutant PDB doesn't look valid — skipping");
          }
        }

        // Model 2 (or 1 if no mutant): docked ligand pose. Backend converts
        // PDBQT → PDB before serving because 3Dmol's PDBQT parser silently
        // drops atoms with non-PDB columns. Same skip-on-invalid policy as
        // the mutant — receptor + WT side chain is still a useful view if
        // the pose isn't ready yet.
        if (posePdbqt && looksLikePdb(posePdbqt)) {
          try {
            viewer.addModel(posePdbqt, "pdb");
          } catch (e) {
            console.warn("pose addModel failed; rendering receptor only", e);
          }
        }

        // All visual style decisions (backbone, contacts, side-chain blend,
        // pose, hydrogens) live in one place now.
        applyAllStyles(viewer);

        // Translucent pocket sphere
        if (pocketCenter) {
          viewer.addSphere({
            center: { x: pocketCenter[0], y: pocketCenter[1], z: pocketCenter[2] },
            radius: pocketRadius,
            color: "#14b8a6",
            opacity: 0.12,
          });
        }

        // Camera: ALWAYS fit everything first (bulletproof). Then frame on the
        // pose (if we have it) since the user mostly cares about the binding
        // site. Falls back to mutation residue, then to whole structure.
        viewer.zoomTo();
        if (posePdbqt) {
          try { viewer.zoomTo({ model: poseModelIdx }); viewer.zoom(0.55); } catch { /* fallback */ }
        } else if (mutationResidue != null) {
          const sel: any = { model: 0, resi: mutationResidue };
          if (chain) sel.chain = chain;
          try { viewer.zoomTo(sel); viewer.zoom(0.4); } catch { /* fallback */ }
        }
        viewer.render();
        viewer.resize();

        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            try { viewer.resize(); viewer.render(); } catch { /* ignore */ }
          });
          resizeObserver.observe(container);
        }

        if (!cancelled) setLoading(false);
      } catch (e) {
        console.error("MutationOverlayViewer error:", e);
        // Stale-chunk recovery — if this was a 'Failed to fetch dynamically
        // imported module' error caused by a redeploy renaming the 3Dmol
        // chunk, force a page reload so the browser picks up the fresh
        // index.html. Without this we'd just sit on the old index.html
        // forever, showing a permanent "Couldn't load" card. Returns true
        // when it triggers a reload — bail out before setError so the
        // component doesn't briefly flash the error before reload kicks in.
        if (tryReloadOnChunkError(e)) return;
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
      if (viewerRef.current) {
        try { viewerRef.current.clear(); } catch { /* ignore */ }
        viewerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wtPdb, mutantPdb, posePdbqt, JSON.stringify(contacts), chain, mutationResidue, pocketCenter?.[0], pocketCenter?.[1], pocketCenter?.[2], pocketRadius, isFullscreen]);

  // Re-apply ALL styles whenever any control changes (blend slider, backbone,
  // pose, H toggle). Single re-render path keeps the scene consistent.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    try {
      applyAllStyles(viewer);
      viewer.render();
    } catch (e) {
      console.warn("style re-apply failed:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blend, backboneStyle, poseStyle, showH, surfaceColor]);

  // Spin animation — toggled independently of style state so we can start/stop
  // without re-applying everything.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    try {
      // 3Dmol's spin() takes an axis ('x'/'y'/'z') or false to stop.
      viewer.spin(spinning ? "y" : false);
    } catch (e) {
      console.warn("spin toggle failed:", e);
    }
  }, [spinning]);

  // 3Dmol caches the canvas's bounding rect at construction time and uses it
  // for click→ray projection. When the page scrolls or the layout shifts
  // (parent panel resizes, sidebar collapse, viewport zoom), the canvas's
  // actual on-screen position drifts but the cached rect doesn't — so click
  // hit-tests pick the atom at the WRONG screen position. The fix: refresh
  // the canvas bounds on every scroll/resize event by calling viewer.resize()
  // (cheap — just re-reads getBoundingClientRect, doesn't re-render geometry).
  // Without this, the user reports clicks land on atoms an inch off from the
  // cursor after they've scrolled into view.
  useEffect(() => {
    const refresh = () => {
      const v = viewerRef.current;
      if (!v) return;
      try { v.resize(); } catch { /* ignore */ }
    };
    window.addEventListener("scroll", refresh, { passive: true, capture: true });
    window.addEventListener("resize", refresh, { passive: true });
    return () => {
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  }, []);

  /** Canvas background simply follows the site theme — white in light
   *  mode, deep slate in dark mode. We used to force dark when Surface
   *  mode was active to compensate for SAS surfaces leaving literal holes
   *  through the protein where the binding pocket is, but the proper fix
   *  is switching the surface type to MS (solvent-excluded / Connolly)
   *  which gives a closed-shell mesh with the pocket as a depression
   *  rather than a hole. Now the cavity reads as same-color depth in
   *  both themes, so the BG can stay theme-appropriate. */
  function pickCanvasBackground(): string {
    const isDark = document.documentElement.classList.contains("dark");
    return isDark ? "#0f172a" : "white";
  }

  // Live-track theme changes — when the user flips the theme toggle, swap the
  // 3Dmol canvas background without remounting the viewer (which would re-fetch
  // and re-style everything from scratch).
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      try {
        viewer.setBackgroundColor(pickCanvasBackground());
        viewer.render();
      } catch { /* ignore — viewer may not be ready */ }
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backboneStyle]);

  // Sync canvas background whenever the user toggles in/out of Surface mode.
  // Without this, switching from Cartoon (white BG in light theme) to Surface
  // would keep the white BG and the pocket cavity would clip to white,
  // losing the depth-of-pocket effect that makes Surface useful as a hero
  // visual. Same in reverse — leaving Surface for Cartoon should restore
  // the theme-appropriate BG so the cartoon ribbon doesn't sit on dark slate
  // in light mode.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    try {
      viewer.setBackgroundColor(pickCanvasBackground());
      viewer.render();
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backboneStyle]);

  /** Reset the camera back to a sensible default — frame the pose if we have
   *  one, otherwise the mutation residue, otherwise the whole structure. */
  function resetView() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    try {
      viewer.zoomTo();
      if (posePdbqt) {
        viewer.zoomTo({ model: poseModelIdx });
        viewer.zoom(0.55);
      } else if (mutationResidue != null) {
        const sel: any = { model: 0, resi: mutationResidue };
        if (chain) sel.chain = chain;
        viewer.zoomTo(sel);
        viewer.zoom(0.4);
      }
      viewer.render();
    } catch (e) {
      console.warn("reset view failed:", e);
    }
  }

  function bumpZoom(factor: number) {
    const viewer = viewerRef.current;
    if (!viewer) return;
    try { viewer.zoom(factor, 200); } catch { /* ignore */ }
  }

  // ── Measure mode: click two atoms → labeled dashed line with distance ──
  // Toggling the mode rebinds atom-click handlers. Off = atoms not clickable
  // (don't interfere with rotate/pan/zoom). On = every atom clickable;
  // first click highlights, second click draws cylinder + label.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (measureMode) {
      // Refresh the canvas's screen bounds before installing the click
      // handler. 3Dmol's hit-test ray uses these bounds to map click pixel →
      // 3D ray; if they're stale (e.g. user scrolled before clicking
      // Measure), the very first pick will land on the wrong atom.
      try { viewer.resize(); } catch { /* ignore */ }

      const onAtomClick = (atom: any) => {
        if (!atom || typeof atom.x !== "number") return;
        if (!firstAtomRef.current) {
          firstAtomRef.current = atom;
          setFirstAtomPicked(true);  // re-render: button label switches to "pick 2nd atom"
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
        const sphereB = viewer.addSphere({
          center: { x: b.x, y: b.y, z: b.z },
          radius: 0.45,
          color: "#f59e0b",
          opacity: 0.95,
        });

        measureShapesRef.current.shapes.push(cyl, sphereB);
        measureShapesRef.current.labels.push(lbl);

        const fmtAtom = (x: any) =>
          `${x.resn ?? "?"}${x.resi ?? ""}${x.chain ? `.${x.chain}` : ""}/${x.atom ?? "?"}`;
        setMeasurements((prev) => [
          ...prev,
          { id: Date.now() + Math.random(), label: `${fmtAtom(a)} ↔ ${fmtAtom(b)}`, distance: dist },
        ]);

        firstAtomRef.current = null;
        setFirstAtomPicked(false);  // back to "pick 1st atom" state
        viewer.render();
      };

      try {
        viewer.setClickable({}, true, onAtomClick);
        viewer.render();
      } catch (e) {
        console.warn("measure mode: setClickable failed", e);
      }
    } else {
      try {
        for (const s of measureShapesRef.current.shapes) viewer.removeShape(s);
        for (const l of measureShapesRef.current.labels) viewer.removeLabel(l);
      } catch { /* ignore */ }
      measureShapesRef.current = { shapes: [], labels: [] };
      firstAtomRef.current = null;
      setFirstAtomPicked(false);
      try { viewer.setClickable({}, false, () => {}); } catch { /* ignore */ }
      viewer.render();
      setMeasurements([]);
    }
  }, [measureMode, loading, error]);   // re-run when the viewer finishes loading too

  // Human-readable label for the current blend zone
  const blendLabel =
    !mutantPdb || mutationResidue == null
      ? null
      : blend < 0.25
      ? "WT only"
      : blend > 0.75
      ? "Mutant only"
      : "Both shown";

  return (
    <div
      className={`flex flex-col rounded-lg overflow-hidden border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 ${className}`}
      style={!isFullscreen ? { minHeight: 360 } : undefined}
    >
      {/* ── Canvas area: 3Dmol viewer + all floating overlays ───────── */}
      <div
        className="relative flex-1 min-h-0"
        style={!isFullscreen ? { minHeight: 320 } : undefined}
      >
        <div
          ref={containerRef}
          className="w-full h-full"
          style={{
            minHeight: isFullscreen ? "100%" : 320,
            position: "relative",
          }}
        />

        {/* Measure-mode toggle — bottom-left of the canvas, away from the
            top-right fullscreen control and the bottom-right info chip.
            The button label rolls in the "pick second atom" hint so we don't
            need a separate floating tooltip. */}
        {!loading && !error && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMeasureMode((m) => !m); }}
            aria-pressed={measureMode}
            title={measureMode
              ? "Measuring: click two atoms for a distance label, or click here to exit."
              : "Distance measure: click to enable, then click two atoms."
            }
            className={`absolute bottom-2 left-2 z-10 text-[11px] font-semibold px-2.5 py-1.5 rounded-md ring-1 transition-colors shadow-sm ${
              measureMode
                ? "bg-amber-500 text-white ring-amber-600 hover:bg-amber-600"
                : "bg-white/90 text-slate-700 ring-slate-200 hover:bg-amber-50 hover:text-amber-700 dark:bg-slate-700/90 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-amber-900/40 dark:hover:text-amber-200"
            }`}
          >
            {!measureMode
              ? "📏 Measure"
              : firstAtomPicked
                ? "↳ Pick 2nd atom"
                : "✕ Measuring · pick 1st atom"}
          </button>
        )}

        {/* Top-right fullscreen toggle (hidden when modal shows its own X) */}
        {!hideExpandButton && (
          <button
            onClick={(e) => { e.stopPropagation(); onExpand(); }}
            className="absolute top-2 right-2 z-10 bg-white/90 hover:bg-white text-slate-600 hover:text-ink rounded-md ring-1 ring-slate-200 p-1.5 transition-colors dark:bg-slate-700/90 dark:hover:bg-slate-700 dark:text-slate-400 dark:hover:text-slate-100 dark:ring-slate-600"
            title={isFullscreen ? "Close (Esc)" : "Expand viewer"}
            aria-label={isFullscreen ? "Close fullscreen" : "Expand viewer"}
          >
            {isFullscreen ? <Close size={14} /> : <ExpandIcon size={14} />}
          </button>
        )}

        {/* Measurements readout — stacks the most recent 5 distances above
            the Measure button. Hidden when off. (The mid-measurement hint
            now lives inside the button label itself.) */}
        {measureMode && measurements.length > 0 && (
          <div
            className="absolute bottom-12 left-2 z-10 max-w-[60%] text-[10px] font-mono bg-slate-900/90 text-amber-200 rounded px-2 py-1.5 shadow ring-1 ring-amber-500/40 pointer-events-none"
          >
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

        {/* Blend slider — only meaningful when we actually have a mutant */}
        {mutantPdb && mutationResidue != null && !loading && !error && (
          <div className={`absolute top-2 ${hideExpandButton ? "left-2 right-2" : "left-2 right-12"} flex items-center gap-2 bg-white/95 backdrop-blur rounded-md px-3 py-1.5 ring-1 ring-slate-200 text-xs dark:bg-slate-800/95 dark:ring-slate-700`}>
            <span className="text-emerald-600 font-semibold dark:text-emerald-400">WT</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={blend}
              onChange={(e) => setBlend(parseFloat(e.target.value))}
              className="flex-1 accent-delta-500"
            />
            <span className="text-delta-600 font-semibold dark:text-delta-400">Mutant</span>
            {blendLabel && (
              <span className="hidden sm:inline ml-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold border-l border-slate-200 pl-2 dark:text-slate-400 dark:border-slate-700">
                {blendLabel}
              </span>
            )}
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 text-slate-500 pointer-events-none dark:bg-slate-800/80 dark:text-slate-400">
            <Spinner size={20} />
            <p className="text-xs mt-2">Loading structures…</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-rose-50/95 text-rose-700 text-xs p-4 text-center dark:bg-rose-900/30 dark:text-rose-400">
            <p className="font-semibold mb-1">Couldn't load</p>
            <p className="text-[11px]">{error}</p>
          </div>
        )}
        {!loading && !error && (
          <>
            {/* Top-left provenance pill (below the slider) */}
            {posePdbqt && variantLabel && (
              <div className={`absolute ${mutantPdb && mutationResidue != null ? "top-12" : "top-2"} left-2 text-[10px] bg-white/95 backdrop-blur ring-1 ring-slate-200 rounded-md px-2 py-1 pointer-events-none flex items-center gap-1.5 dark:bg-slate-800/95 dark:ring-slate-700`}>
                <span className="w-1.5 h-1.5 rounded-full bg-delta-500" />
                <span className="text-slate-600 dark:text-slate-400">pose vs.</span>
                <span className="font-mono font-semibold text-delta-700 dark:text-delta-400">{variantLabel}</span>
                <span className="text-slate-400 dark:text-slate-500">receptor</span>
              </div>
            )}
            <div className="absolute bottom-2 right-2 text-[10px] text-slate-400 bg-white/80 px-1.5 py-0.5 rounded pointer-events-none dark:text-slate-500 dark:bg-slate-800/80">
              {atomCount != null && `${atomCount} atoms · `}drag to rotate
            </div>
          </>
        )}
      </div>

      {/* ── Control toolbar (PubChem-style) ──────────────────────────── */}
      {!loading && !error && (
        <ControlToolbar
          backboneStyle={backboneStyle}
          setBackboneStyle={setBackboneStyle}
          poseStyle={poseStyle}
          setPoseStyle={setPoseStyle}
          showH={showH}
          setShowH={setShowH}
          spinning={spinning}
          setSpinning={setSpinning}
          surfaceColor={surfaceColor}
          setSurfaceColor={setSurfaceColor}
          surfaceComputing={surfaceComputing}
          onZoomIn={() => bumpZoom(1.25)}
          onZoomOut={() => bumpZoom(0.8)}
          onReset={resetView}
          hasPose={!!posePdbqt}
        />
      )}
    </div>
  );
}

/* ─────────────────────── Control toolbar ───────────────────────────── */

interface ControlToolbarProps {
  backboneStyle: BackboneStyle;
  setBackboneStyle: (s: BackboneStyle) => void;
  poseStyle: PoseStyle;
  setPoseStyle: (s: PoseStyle) => void;
  showH: boolean;
  setShowH: (b: boolean) => void;
  spinning: boolean;
  setSpinning: (b: boolean) => void;
  surfaceColor: SurfaceColor;
  setSurfaceColor: (c: SurfaceColor) => void;
  surfaceComputing: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  hasPose: boolean;
}

function ControlToolbar(p: ControlToolbarProps) {
  return (
    <div className="border-t border-slate-200 bg-slate-50/60 px-2 py-1.5 flex flex-col gap-1 text-[11px] dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-center gap-2 flex-wrap">
      {/* Backbone style group */}
      <div className="flex items-center gap-1">
        <span className="text-slate-500 font-medium pr-1 dark:text-slate-400">Backbone:</span>
        <SegButton active={p.backboneStyle === "cartoon"}  onClick={() => p.setBackboneStyle("cartoon")}  title="Cartoon ribbon">Cartoon</SegButton>
        <SegButton active={p.backboneStyle === "line"}     onClick={() => p.setBackboneStyle("line")}     title="Wire-frame">Line</SegButton>
        <SegButton active={p.backboneStyle === "sphere"}   onClick={() => p.setBackboneStyle("sphere")}   title="Space-filling spheres">Sphere</SegButton>
        <SegButton active={p.backboneStyle === "surface"}  onClick={() => p.setBackboneStyle("surface")}  title="Solvent-accessible molecular surface — best for showing the ligand inside the binding pocket">Surface</SegButton>
        <SegButton active={p.backboneStyle === "hidden"}   onClick={() => p.setBackboneStyle("hidden")}   title="Hide backbone (pose + side chains only)">Hide</SegButton>
      </div>

      {/* Pose style group — only meaningful when there's a pose loaded */}
      {p.hasPose && (
        <div className="flex items-center gap-1 border-l border-slate-200 pl-2 ml-1 dark:border-slate-700">
          <span className="text-slate-500 font-medium pr-1 dark:text-slate-400">Pose:</span>
          <SegButton active={p.poseStyle === "stick"}        onClick={() => p.setPoseStyle("stick")}        title="Sticks">Stick</SegButton>
          <SegButton active={p.poseStyle === "ballAndStick"} onClick={() => p.setPoseStyle("ballAndStick")} title="Ball-and-stick">Ball</SegButton>
          <SegButton active={p.poseStyle === "line"}         onClick={() => p.setPoseStyle("line")}         title="Wire-frame">Line</SegButton>
          <SegButton active={p.poseStyle === "sphere"}       onClick={() => p.setPoseStyle("sphere")}       title="Space-filling">Sphere</SegButton>
        </div>
      )}

      <div className="flex-1" />

      {/* Toggles + actions */}
      <div className="flex items-center gap-1">
        <ToggleButton active={p.showH} onClick={() => p.setShowH(!p.showH)} title={p.showH ? "Hide hydrogens" : "Show hydrogens"}>
          <span className="font-mono text-[10px]">H</span>
        </ToggleButton>
        <ToggleButton active={p.spinning} onClick={() => p.setSpinning(!p.spinning)} title={p.spinning ? "Stop rotation" : "Animate (spin)"}>
          <SpinIcon spinning={p.spinning} />
        </ToggleButton>
        <IconButton onClick={p.onZoomOut} title="Zoom out">
          <span className="font-bold text-sm leading-none">−</span>
        </IconButton>
        <IconButton onClick={p.onZoomIn} title="Zoom in">
          <span className="font-bold text-sm leading-none">+</span>
        </IconButton>
        <IconButton onClick={p.onReset} title="Reset view">
          <ResetIcon />
        </IconButton>
      </div>
      </div>

      {/* Surface coloring sub-row — only shown when Surface is the active
          backbone mode. Three coloring choices: plain (cosmetic), Kyte-
          Doolittle hydrophobicity (binding-pocket chemistry), and a charge
          surrogate at neutral pH (catches Lys/Arg → polar mutations). */}
      {p.backboneStyle === "surface" && (
        <div className="flex items-center gap-1 pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
          <span className="text-slate-500 font-medium pr-1 dark:text-slate-400">
            Color: {p.surfaceComputing && <span className="text-delta-600 dark:text-delta-400 italic">computing…</span>}
          </span>
          <SegButton active={p.surfaceColor === "plain"}          onClick={() => p.setSurfaceColor("plain")}          title="Uniform color — cleanest hero shot for showing the ligand inside the pocket">Plain</SegButton>
          <SegButton active={p.surfaceColor === "hydrophobicity"} onClick={() => p.setSurfaceColor("hydrophobicity")} title="Kyte-Doolittle scale: hydrophobic residues amber, polar residues cyan. Reveals where the binding groove's lipid-loving region sits.">Hydrophobicity</SegButton>
          <SegButton active={p.surfaceColor === "electrostatic"}  onClick={() => p.setSurfaceColor("electrostatic")}  title="Per-residue charge surrogate at pH 7: Lys/Arg blue, Asp/Glu red, His light blue. Spots charge-flip mutations near the pocket.">Electrostatic</SegButton>
        </div>
      )}
    </div>
  );
}

function SegButton({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 py-0.5 rounded transition-colors ${
        active
          ? "bg-delta-600 text-white font-semibold shadow-sm dark:bg-delta-500"
          : "bg-white text-slate-600 hover:bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:ring-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

function ToggleButton({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
        active
          ? "bg-delta-600 text-white shadow-sm dark:bg-delta-500"
          : "bg-white text-slate-600 hover:bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:ring-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-7 h-7 rounded bg-white text-slate-600 hover:bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center transition-colors dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:ring-slate-600"
    >
      {children}
    </button>
  );
}

function SpinIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={spinning ? "animate-spin" : ""}>
      <path d="M21 12a9 9 0 1 1-6.2-8.55" />
      <polyline points="21 4 21 9 16 9" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function ExpandIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}
