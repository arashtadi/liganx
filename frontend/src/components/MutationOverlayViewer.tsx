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
  /** When true, `wtPdb` is interpreted as a complete protein-ligand COMPLEX
   *  (protein chain + ligand chain in one PDB), not just a receptor. The
   *  viewer renders the protein chain as backbone and the ligand chain as
   *  stick, all from model 0. `mutantPdb` and `posePdbqt` are ignored.
   *
   *  Used for Boltz-2 cells where the AI model predicts the whole complex
   *  in its own coordinate frame — the crystal WT receptor isn't comparable
   *  (different coords) so we don't load it.
   *
   *  Expected chain layout (per boltz2_server_async.py):
   *    chain `chain` (default "A") → protein (cartoon)
   *    chain "L"                   → ligand (stick) */
  isComplex?: boolean;
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

type XYZ = { x: number; y: number; z: number };
interface Measurement { id: number; label: string; distance: number; a: XYZ; b: XYZ }

export default function MutationOverlayViewer(props: Props) {
  const [fullscreen, setFullscreen] = useState(false);
  // One-shot flag: set when the user taps Measure on the INLINE viewer. It
  // opens fullscreen and tells the modal viewer to start in measure mode so
  // atom-picking happens on the big canvas (imprecise in the small view).
  const [autoMeasure, setAutoMeasure] = useState(false);
  // Measurements are LIFTED here so they survive the inline<->fullscreen swap
  // (both ViewerCanvas instances share the same molecule coords and redraw the
  // list). Stored as endpoint coords + distance, NOT 3Dmol shape handles
  // (those are per-viewer-instance and can't be shared).
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  // ── Toolbar state, LIFTED to the parent ─────────────────────────────
  // These were previously local to ViewerCanvas, which meant the inline
  // viewer and the fullscreen viewer kept independent useState — opening
  // fullscreen reset Backbone, Pose, surface color, blend, etc. back to
  // defaults. Lifting up means both ViewerCanvas instances read the same
  // values and writes propagate to both.
  //
  // ── Camera state, also LIFTED ───────────────────────────────────────
  // Camera angle / zoom lives in 3Dmol's viewer object (not React state),
  // so opening fullscreen used to reset rotation back to the default
  // pose-fit zoom even though filters survived. We now keep the active
  // viewer's getView() copied into this ref ~4 times/sec, and the other
  // ViewerCanvas applies it via setView() when it mounts (or when it
  // becomes the active viewer again). Net effect: rotate the inline
  // viewer, hit expand, fullscreen opens at the same orientation; close
  // fullscreen, inline picks up whatever orientation you ended on. Refs
  // (not state) so flipping fullscreen doesn't trigger a render storm.
  const cameraViewRef = useRef<number[] | null>(null);
  const [backboneStyle, setBackboneStyle] = useState<BackboneStyle>("cartoon");
  const [poseStyle, setPoseStyle] = useState<PoseStyle>("stick");
  const [showH, setShowH] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [surfaceColor, setSurfaceColor] = useState<SurfaceColor>("plain");
  // Contact-residue side-chain sticks. ProLIF gives us a list of residues
  // the ligand touches — we render each as a coloured stick so the user
  // can see WHAT the ligand is binding to. Defaults ON (most users want
  // the context). Toggle OFF to declutter the view down to just the
  // ligand + backbone — useful when there are 10+ contacts and the
  // sticks crowd the pose.
  const [showContacts, setShowContacts] = useState(true);
  const [blend, setBlend] = useState(
    props.initialBlend ?? (props.mutantPdb ? 0.5 : 0)
  );

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

  // Leaving fullscreen clears the jump-to-measure flag so a later manual
  // expand doesn't silently re-enter measure mode.
  useEffect(() => { if (!fullscreen) setAutoMeasure(false); }, [fullscreen]);

  // Pack the lifted state into a single object we can spread onto both
  // ViewerCanvas instances. Keeping this in one place avoids the two
  // call sites drifting out of sync as we add new toolbar controls.
  const sharedToolbar = {
    backboneStyle, setBackboneStyle,
    poseStyle, setPoseStyle,
    showH, setShowH,
    showContacts, setShowContacts,
    spinning, setSpinning,
    surfaceColor, setSurfaceColor,
    blend, setBlend,
    cameraViewRef,
    measurements, setMeasurements,
  };

  return (
    <>
      <ViewerCanvas
        {...props}
        {...sharedToolbar}
        onExpand={() => setFullscreen(true)}
        onRequestFullscreenMeasure={() => { setAutoMeasure(true); setFullscreen(true); }}
        isFullscreen={false}
        // Inline viewer is the camera authority while fullscreen is closed.
        // When fullscreen opens we hand the role to the modal viewer so the
        // hidden inline doesn't overwrite the user's rotations there.
        cameraSyncActive={!fullscreen}
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
                {...sharedToolbar}
                isFullscreen
                onExpand={() => setFullscreen(false)}
                autoMeasure={autoMeasure}
                onAutoMeasureConsumed={() => setAutoMeasure(false)}
                className="h-full"
                hideExpandButton  // header has its own close X
                // Modal viewer owns the camera while it's mounted.
                cameraSyncActive
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
  isComplex,
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
  // ── Lifted toolbar state from MutationOverlayViewer ───────────────────
  // These were local useState here, which meant the inline viewer and the
  // fullscreen viewer had independent toolbar state — opening fullscreen
  // reset everything. Now both ViewerCanvas instances read the same values
  // from the parent so toolbar choices persist across the toggle.
  backboneStyle,
  setBackboneStyle,
  poseStyle,
  setPoseStyle,
  showH,
  setShowH,
  showContacts,
  setShowContacts,
  spinning,
  setSpinning,
  surfaceColor,
  setSurfaceColor,
  blend,
  setBlend,
  cameraViewRef,
  cameraSyncActive,
  onRequestFullscreenMeasure,
  autoMeasure,
  onAutoMeasureConsumed,
  measurements,
  setMeasurements,
}: Props & {
  isFullscreen: boolean;
  onExpand: () => void;
  hideExpandButton?: boolean;
  backboneStyle: BackboneStyle;
  setBackboneStyle: (s: BackboneStyle) => void;
  poseStyle: PoseStyle;
  setPoseStyle: (s: PoseStyle) => void;
  showH: boolean;
  setShowH: (b: boolean) => void;
  showContacts: boolean;
  setShowContacts: (b: boolean) => void;
  spinning: boolean;
  setSpinning: (b: boolean) => void;
  surfaceColor: SurfaceColor;
  setSurfaceColor: (c: SurfaceColor) => void;
  blend: number;
  setBlend: (n: number) => void;
  /** Shared mutable view-matrix slot. Two ViewerCanvas siblings (inline +
   *  fullscreen modal) read/write this so camera orientation survives the
   *  fullscreen toggle. The active viewer copies its getView() into here
   *  on a low-rate poll; the inactive viewer applies it on transition. */
  cameraViewRef: { current: number[] | null };
  /** True when this viewer is the camera authority — meaning it should
   *  poll its own getView() into cameraViewRef and consume incoming view
   *  updates. The inline instance is active while fullscreen is closed;
   *  the modal instance is active for its entire lifetime. */
  cameraSyncActive: boolean;
  /** Inline viewer only: called when the user taps Measure — the parent
   *  opens fullscreen and flags autoMeasure so measuring starts on the big
   *  canvas. */
  onRequestFullscreenMeasure?: () => void;
  /** Fullscreen viewer only: start in measure mode on mount. */
  autoMeasure?: boolean;
  /** Fullscreen viewer only: clears the one-shot autoMeasure flag. */
  onAutoMeasureConsumed?: () => void;
  /** Persistent measurement list, lifted to the parent so it survives the
   *  inline<->fullscreen viewer swap. */
  measurements: Measurement[];
  setMeasurements: (u: Measurement[] | ((prev: Measurement[]) => Measurement[])) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  // The 3Dmol namespace itself, stashed during load() so applyAllStyles can
  // reach SurfaceType constants. Surface coloring needs $3Dmol.SurfaceType.SAS;
  // hard-coded literal (2) is used as a fallback if the namespace isn't ready.
  const dmolNsRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [atomCount, setAtomCount] = useState<number | null>(null);
  // initialBlend is consumed at the parent (MutationOverlayViewer) where the
  // shared blend state is initialized. Here we just receive `blend` as a
  // prop and hand setBlend back when the slider moves.
  void initialBlend;
  // Tracks whether the surface generation is currently in flight (3Dmol's
  // addSurface is CPU-heavy, ~0.5–2 s for a typical kinase). Used to fade
  // the toolbar so users know the click registered.
  const [surfaceComputing, setSurfaceComputing] = useState(false);
  // Surface handles need to be removed before re-adding when style or
  // color changes — otherwise they stack and drag rendering to a crawl.
  // We don't actually rely on these handles for cleanup (we use
  // removeAllSurfaces below) but keep the ref for potential future use
  // and to suppress 'unused' warnings.
  const surfaceHandlesRef = useRef<any[]>([]);
  // Generation counter for in-flight addSurface promises. 3Dmol's
  // addSurface can return a Promise that resolves several hundred
  // milliseconds after the call — long enough for the user to click a
  // different style. If we don't invalidate the in-flight promise, its
  // late-resolving surface mesh paints over the new style and the user
  // appears "stuck in Surface mode". Bumping this ref on every applyAll
  // means any older addSurface that resolves later sees a mismatched gen
  // and immediately removes itself.
  const surfaceGenRef = useRef(0);
  // Tracks what surface params (backbone mode + color) we last actually
  // built. Used to skip the expensive rebuild when applyAllStyles fires
  // for unrelated reasons (pose style, H toggle, blend slider). Without
  // this, the surface visibly disappeared and re-rendered every time the
  // user touched the toolbar — both ugly AND laggy on bigger receptors.
  const lastSurfaceRef = useRef<{ backbone: BackboneStyle; color: SurfaceColor } | null>(null);

  // ── Measure-mode state ──────────────────────────────────────────────
  // When ON, atoms become clickable; pick two atoms to draw a labeled dashed
  // line with the inter-atomic distance in Å. Toggling OFF clears all drawn
  // measurements.
  //   `firstAtomRef`        — actual atom payload (closure-stable, used in
  //                           the click handler for distance math).
  //   `firstAtomPicked`     — paired state mirror so the button label can
  //                           re-render between the 1st and 2nd click.
  //   `drawnMeasureRef`     — handles to persistent measurement shapes for redraw.
  const [measureMode, setMeasureMode] = useState(false);
  const firstAtomRef = useRef<any>(null);
  const [firstAtomPicked, setFirstAtomPicked] = useState(false);
  // Transient highlight for the 1st-picked atom (before the pair completes).
  const firstHighlightRef = useRef<any>(null);
  // Hover highlight sphere — responsiveness feedback while picking.
  const hoverHighlightRef = useRef<any>(null);
  // Handles to the PERSISTENT measurement shapes/labels this instance drew, so
  // the redraw effect can clear + redraw from the lifted `measurements` list.
  const drawnMeasureRef = useRef<{ shapes: any[]; labels: any[] }>({ shapes: [], labels: [] });

  // Index of the pose model: depends on whether we loaded a mutant or not.
  // In complex mode the ligand lives INSIDE model 0 (alongside the protein
  // chain), so there's no separate pose model — selectors target model 0
  // with chain="L" or hetflag=true to pick out the ligand atoms.
  const poseModelIdx = isComplex ? 0 : (mutantPdb ? 2 : 1);
  // Ligand chain ID for complex mode. boltz2_server_async.py writes the
  // ligand under chain "L" by convention (separate from the protein
  // chain). When isComplex, we use this to apply the pose-style selector.
  const COMPLEX_LIGAND_CHAIN = "L";

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
    // Surface lifecycle is decoupled from the rest of applyAllStyles.
    // We only tear down + rebuild the surface mesh when the user
    // ACTUALLY changes something surface-relevant (backbone mode or
    // surface color). Touching pose style / H toggle / blend slider
    // leaves the existing surface in place — no flicker, no rebuild.
    //
    // Without this gate, the surface visibly disappeared every time
    // the user clicked the Pose toolbar because applyAllStyles always
    // ran clear-surfaces → addSurface, with a 200–500 ms gap between
    // the two while the marching-cubes mesh regenerated.
    const wantSurface = backboneStyle === "surface";
    const last = lastSurfaceRef.current;
    const surfaceModeChanged = wantSurface !== !!last;
    const surfaceColorChanged = !!last && last.color !== surfaceColor;
    const needsSurfaceRebuild = surfaceModeChanged || surfaceColorChanged;
    if (needsSurfaceRebuild) {
      // removeAllSurfaces is handle-agnostic (works whether 3Dmol's
      // addSurface returned a numeric ID or a Promise). Bumping the
      // gen counter invalidates any in-flight addSurface that
      // resolves after this clear.
      safe("clear-surfaces", () => {
        surfaceGenRef.current++;
        try { viewer.removeAllSurfaces?.(); } catch { /* ignore */ }
        surfaceHandlesRef.current = [];
        lastSurfaceRef.current = null;
      });
    }

    if (backboneStyle === "surface") {
      // Only rebuild the mesh if backbone or color actually changed —
      // see needsSurfaceRebuild gate above. If we're already in Surface
      // mode and the user just changed pose style or H toggle or the
      // blend slider, the surface stays exactly as it was: no
      // disappear-then-rebuild flicker, no marching-cubes recompute.
      if (needsSurfaceRebuild) {
        try { setSurfaceComputing(true); } catch { /* ignore */ }
        // MS (molecular surface, a.k.a. Connolly / solvent-excluded
        // surface) wraps the protein tightly with a closed-shell mesh.
        // The binding pocket renders as a deep depression in the same-
        // colored material — the "ligand sitting in a colored cave"
        // look. SAS (solvent-accessible) leaves literal holes through
        // to the canvas BG, which read as a void instead of a
        // depression.
        const surfType = dmolNsRef.current?.SurfaceType?.MS ?? 1; // MS=1
        // Fully opaque so the pocket interior reads as solid material
        // rather than transparent through to the BG.
        const opts: Record<string, any> = { opacity: 1.0 };
        if (surfaceColor === "plain") {
          opts.color = "#a78bfa"; // light violet — matches the hero look
        } else {
          // Property coloring per atom by residue name.
          const fn = surfaceColor === "hydrophobicity" ? hydroColor : chargeColor;
          opts.colorfunc = (atom: any) => fn(String(atom?.resn || "").toUpperCase());
        }
        safe("add-surface", () => {
          // Capture the generation at call time. If the user switches
          // away before this addSurface resolves, the gen will have
          // advanced and we'll know to tear down the late mesh.
          const myGen = surfaceGenRef.current;
          const result = viewer.addSurface(surfType, opts, { model: 0 });
          const isPromise = result && typeof (result as any).then === "function";
          const onReady = () => {
            if (surfaceGenRef.current !== myGen) {
              // User switched modes while this surface was building.
              // Tear it down so it doesn't paint over the new style.
              try { viewer.removeAllSurfaces?.(); viewer.render(); } catch { /* ignore */ }
              return;
            }
            // Record what we just built so future applyAllStyles calls
            // for unrelated reasons (pose change etc.) can short-circuit.
            lastSurfaceRef.current = { backbone: "surface", color: surfaceColor };
            try { viewer.render(); } catch { /* ignore */ }
            requestAnimationFrame(() => setSurfaceComputing(false));
          };
          if (isPromise) {
            (result as Promise<any>).then(onReady, onReady);
          } else {
            if (result != null) surfaceHandlesRef.current.push(result);
            onReady();
          }
        });
      }
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
        // In complex mode the ligand atoms also live in model 0 under chain
        // "L", so an unconstrained {model: 0} selector would draw cartoon
        // through the ligand too — visually weird and overlaps with the
        // pose stick rendering. Restrict the backbone to the protein chain.
        const backboneSel: any = { model: 0 };
        if (isComplex) backboneSel.chain = chain ?? "A";
        safe("backbone", () => viewer.setStyle(backboneSel, backboneSpec));
      }
      setSurfaceComputing(false);
    }

    // Step 3: contact residues coloured by interaction type, on model 0.
    // Gated by the showContacts toolbar toggle so users can declutter
    // the view when ProLIF returns 10+ contacts and the side-chain
    // sticks crowd the pose. Default ON.
    if (showContacts && contacts && contacts.length) {
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
        // (U7b) Contact sticks rendered THINNER than the ligand (0.30
        // above) so the user can immediately tell which atoms are
        // 'their compound' vs 'what it's touching'. Same colors,
        // smaller radius — the ligand pops, the residues recede.
        safe(`contact-${resnum}`, () => viewer.addStyle(sel, { stick: { color, radius: 0.15 } }));
      }
    }

    // Step 4: WT/mutant side-chain swap at the mutation residue, controlled
    // by the blend slider's three-zone show/hide.
    // Special case for isComplex+mutantPdb (Boltz-2 aligned): control visibility
    // of the entire mutant complex (model 1) via the blend slider instead of
    // individual side chains, since the fold may be significantly different.
    if (isComplex && mutantPdb) {
      // Three-zone blend: <0.25 = WT only, 0.25-0.75 = both, >0.75 = mutant only
      const showWt = blend < 0.75;
      const showMut = blend > 0.25;
      if (!showWt) {
        // Hide the entire WT complex backbone when mutant is dominant
        safe("hide-wt-bb", () => viewer.setStyle({ model: 0, chain: chain ?? "A" }, {}));
      }
      if (!showMut) {
        // Hide the entire mutant complex backbone when WT is dominant
        safe("hide-mut-bb", () => viewer.setStyle({ model: 1, chain: chain ?? "A" }, {}));
      }
    } else if (mutationResidue != null) {
      const wtSel: any = { model: 0, resi: mutationResidue };
      if (chain) wtSel.chain = chain;
      const mutSel: any = { model: 1, resi: mutationResidue };
      if (chain) mutSel.chain = chain;
      const showWt = blend < 0.75;
      const showMut = blend > 0.25 && !!mutantPdb;
      if (showWt) safe("wt-side", () => viewer.addStyle(wtSel, { stick: { color: "#10b981", radius: 0.32 } }));
      if (showMut) safe("mut-side", () => viewer.addStyle(mutSel, { stick: { color: "#3b6cf6", radius: 0.32 } }));
    }

    // Step 5: pose style on model poseModelIdx (or, in complex mode, on
    // chain "L" inside model 0 — the ligand and protein share one PDB).
    // Special case: isComplex+mutantPdb (Boltz-2 aligned) → apply pose style
    // to chain "L" on BOTH model 0 (WT complex) and model 1 (mutant complex),
    // controlled by blend slider visibility.
    const havePose = !!posePdbqt || isComplex;
    if (havePose) {
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
          // (U7b) Ligand sticks rendered THICKER than contact-residue
          // sticks (which are 0.15 below) so the user can immediately
          // tell which atoms are 'their compound' vs 'what it's
          // touching'. Without this, a backbone-hidden + contacts-on
          // view reads as one fragmented blob.
          poseSpec = { stick: { colorscheme: "Jmol", radius: 0.30 } };
      }
      const poseSel: any = { model: poseModelIdx };
      if (isComplex) poseSel.chain = COMPLEX_LIGAND_CHAIN;
      // addStyle (not setStyle) so the ligand stick is layered on TOP of
      // the protein backbone in complex mode rather than overwriting it.
      // For Vina-mode (pose is a separate model) setStyle works fine
      // because the pose model has nothing else to overwrite, but addStyle
      // is also correct there. Using addStyle uniformly keeps the code
      // simple.
      safe("pose", () => viewer.addStyle(poseSel, poseSpec));

      // When isComplex+mutantPdb, also style the ligand in model 1 (mutant
      // complex). The blend slider controls visibility of both.
      if (isComplex && mutantPdb) {
        const mutPoseSel: any = { model: 1, chain: COMPLEX_LIGAND_CHAIN };
        safe("pose-mut", () => viewer.addStyle(mutPoseSel, poseSpec));
      }
    }

    // Step 6: hydrogen visibility on the ligand. Default is hidden (cleaner
    // view); user can toggle on. Receptor H atoms are usually absent (PDBFixer
    // omits them), so this mostly affects the ligand.
    if (!showH && havePose) {
      const hSel: any = { model: poseModelIdx, elem: "H" };
      if (isComplex) hSel.chain = COMPLEX_LIGAND_CHAIN;
      safe("hide-H", () => viewer.setStyle(hSel, {}));
    }

    // Step 7: MEASURE MODE — overlay faint, colour-coded spheres on every atom
    // so each atom becomes a big, obvious click/hover target. Thin sticks are
    // nearly impossible to pick precisely (the #1 "measuring feels
    // unresponsive" cause). These vanish automatically when measure mode turns
    // off, because this function re-runs (measureMode is in the effect deps)
    // and omits this step. Hydrogens stay excluded to reduce clutter.
    if (measureMode) {
      safe("measure-picktargets", () =>
        viewer.addStyle({ elem: "H", invert: true }, { sphere: { colorscheme: "Jmol", radius: 0.32, opacity: 0.35 } })
      );
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
        // Snappy hover feedback for measure mode (3Dmol default ~500ms lags).
        try { viewer.setHoverDuration?.(60); } catch { /* older 3Dmol */ }

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
        // In isComplex+mutantPdb mode (Boltz-2 aligned WT/mutant overlay),
        // mutantPdb is a full complex (protein + ligand). In normal Vina mode,
        // mutantPdb is just the receptor structure and mutationResidue gates
        // the load.
        if (mutantPdb && (mutationResidue != null || isComplex)) {
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
        if (isComplex) {
          // Frame on the ligand chain inside model 0 — that's where the
          // user's eye should land in a complex view.
          try {
            viewer.zoomTo({ model: 0, chain: COMPLEX_LIGAND_CHAIN });
            viewer.zoom(0.55);
          } catch { /* fallback to whole-structure framing */ }
        } else if (posePdbqt) {
          try { viewer.zoomTo({ model: poseModelIdx }); viewer.zoom(0.55); } catch { /* fallback */ }
        } else if (mutationResidue != null) {
          const sel: any = { model: 0, resi: mutationResidue };
          if (chain) sel.chain = chain;
          try { viewer.zoomTo(sel); viewer.zoom(0.4); } catch { /* fallback */ }
        }
        viewer.render();
        viewer.resize();

        // Restore camera from the parent-shared ref if there's a previous
        // orientation to inherit. This is what makes "rotate inline → expand
        // → fullscreen opens at the same angle" work. We do it AFTER the
        // initial zoomTo/render so the default framing is the fallback for
        // first-mount when the ref is still null.
        if (cameraViewRef.current) {
          try {
            viewer.setView(cameraViewRef.current);
            viewer.render();
          } catch { /* setView shape mismatch — fall back to default fit */ }
        }

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
        // Snapshot the camera into the shared ref before tearing down,
        // so a fast rotate-then-close-fullscreen flow doesn't lose the
        // last 250 ms of rotation that the poll would otherwise miss.
        if (cameraSyncActive) {
          try {
            const v = viewerRef.current.getView?.();
            if (Array.isArray(v) && v.length > 0) cameraViewRef.current = v;
          } catch { /* ignore */ }
        }
        try { viewerRef.current.clear(); } catch { /* ignore */ }
        viewerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wtPdb, mutantPdb, posePdbqt, isComplex, JSON.stringify(contacts), chain, mutationResidue, pocketCenter?.[0], pocketCenter?.[1], pocketCenter?.[2], pocketRadius, isFullscreen]);

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
  }, [blend, backboneStyle, poseStyle, showH, showContacts, surfaceColor, measureMode]);

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

  // ── Camera-state sync across fullscreen toggle ──────────────────────
  // While this ViewerCanvas is the active camera authority, copy its
  // current 3Dmol view into the parent-shared ref ~4× per second. The
  // sibling ViewerCanvas reads from this ref on its load() / on its own
  // active-flip restore (below). 250 ms is fast enough that a quick
  // expand-click can't beat the poll, and slow enough that the cost is
  // negligible (getView() returns a 16-float array — pure math, no GL).
  // Stops polling when cameraSyncActive is false so the hidden inline
  // viewer doesn't overwrite the modal's rotations while it's open.
  useEffect(() => {
    if (!cameraSyncActive) return;
    const id = window.setInterval(() => {
      const viewer = viewerRef.current;
      if (!viewer || typeof viewer.getView !== "function") return;
      try {
        const v = viewer.getView();
        if (Array.isArray(v) && v.length > 0) cameraViewRef.current = v;
      } catch { /* ignore one-off getView hiccups */ }
    }, 250);
    return () => window.clearInterval(id);
  }, [cameraSyncActive, cameraViewRef]);

  // When this viewer FLIPS to active (fullscreen modal closed → inline
  // resumes; or the rare inline → modal-already-mounted handoff), apply
  // whatever the sibling last wrote. Without this the inline viewer would
  // silently keep its pre-fullscreen orientation while the user expects
  // the orientation they last had in the modal.
  useEffect(() => {
    if (!cameraSyncActive) return;
    const viewer = viewerRef.current;
    if (!viewer || typeof viewer.setView !== "function") return;
    if (!cameraViewRef.current) return;
    try {
      viewer.setView(cameraViewRef.current);
      viewer.render();
    } catch { /* ignore */ }
  }, [cameraSyncActive, cameraViewRef]);

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

  // Auto-start measure mode when this (fullscreen) viewer was opened via the
  // inline Measure button. One-shot: consumes the flag so it fires only on
  // the open transition.
  useEffect(() => {
    if (isFullscreen && autoMeasure) {
      setMeasureMode(true);
      onAutoMeasureConsumed?.();
    }
  }, [isFullscreen, autoMeasure]);

  // ── Measure mode: click two atoms → labeled dashed line with distance ──
  // measureMode governs ONLY atom-picking (clickable + hover feedback). The
  // drawn measurement geometry is owned by the redraw effect below and persists
  // regardless of mode — so closing fullscreen keeps the measurements visible
  // in the small view until the user clears them.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !measureMode) return;
    const container = containerRef.current;

    // Refresh screen bounds so the very first pick maps click-pixel → ray
    // correctly (stale bounds send the first click to the wrong atom).
    try { viewer.resize(); } catch { /* ignore */ }
    const canvasEl = container?.querySelector("canvas") as HTMLCanvasElement | null;
    if (container) container.style.cursor = "crosshair";
    if (canvasEl) canvasEl.style.cursor = "crosshair";

    const fmtAtom = (x: any) =>
      `${x.resn ?? "?"}${x.resi ?? ""}${x.chain ? `.${x.chain}` : ""}/${x.atom ?? "?"}`;

    const onAtomClick = (atom: any) => {
      if (!atom || typeof atom.x !== "number") return;
      const pt: XYZ = { x: atom.x, y: atom.y, z: atom.z };
      if (!firstAtomRef.current) {
        firstAtomRef.current = { ...pt, resn: atom.resn, resi: atom.resi, chain: atom.chain, atom: atom.atom };
        setFirstAtomPicked(true);
        firstHighlightRef.current = viewer.addSphere({ center: pt, radius: 0.5, color: "#f59e0b", opacity: 0.95 });
        viewer.render();
        return;
      }
      const a = firstAtomRef.current;
      const dx = a.x - pt.x, dy = a.y - pt.y, dz = a.z - pt.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const label = `${fmtAtom(a)} ↔ ${fmtAtom(atom)}`;
      // Drop the transient first-pick highlight — the redraw effect draws the
      // permanent endpoints + dashed line + label for the completed pair.
      if (firstHighlightRef.current) { try { viewer.removeShape(firstHighlightRef.current); } catch { /* ignore */ } firstHighlightRef.current = null; }
      firstAtomRef.current = null;
      setFirstAtomPicked(false);
      setMeasurements((prev) => [
        ...prev,
        { id: Date.now() + Math.random(), label, distance: dist, a: { x: a.x, y: a.y, z: a.z }, b: pt },
      ]);
    };

    // Hover feedback: highlight the atom under the cursor so the user can see
    // exactly what they'll pick — the single biggest "measuring feels
    // unresponsive" fix.
    const onHover = (atom: any) => {
      if (!atom || typeof atom.x !== "number") return;
      if (hoverHighlightRef.current) { try { viewer.removeShape(hoverHighlightRef.current); } catch { /* ignore */ } }
      hoverHighlightRef.current = viewer.addSphere({ center: { x: atom.x, y: atom.y, z: atom.z }, radius: 0.55, color: "#fbbf24", opacity: 0.85 });
      viewer.render();
    };
    const onUnhover = () => {
      if (hoverHighlightRef.current) { try { viewer.removeShape(hoverHighlightRef.current); } catch { /* ignore */ } hoverHighlightRef.current = null; viewer.render(); }
    };

    try {
      viewer.setClickable({}, true, onAtomClick);
      viewer.setHoverable?.({}, true, onHover, onUnhover);
      viewer.render();
    } catch (e) {
      console.warn("measure mode: setClickable/hover failed", e);
    }

    return () => {
      try { viewer.setClickable({}, false, () => {}); } catch { /* ignore */ }
      try { viewer.setHoverable?.({}, false, () => {}, () => {}); } catch { /* ignore */ }
      if (hoverHighlightRef.current) { try { viewer.removeShape(hoverHighlightRef.current); } catch { /* ignore */ } hoverHighlightRef.current = null; }
      if (firstHighlightRef.current) { try { viewer.removeShape(firstHighlightRef.current); } catch { /* ignore */ } firstHighlightRef.current = null; }
      firstAtomRef.current = null;
      setFirstAtomPicked(false);
      if (container) container.style.cursor = "";
      if (canvasEl) canvasEl.style.cursor = "";
      try { viewer.render(); } catch { /* ignore */ }
    };
  }, [measureMode, loading, error]);

  // Redraw the PERSISTENT measurement geometry whenever the list changes or the
  // viewer (re)loads. Independent of measureMode, so measurements survive the
  // inline<->fullscreen swap and stay drawn until cleared.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || loading || error) return;
    const drawn = drawnMeasureRef.current;
    try {
      for (const sh of drawn.shapes) viewer.removeShape(sh);
      for (const lb of drawn.labels) viewer.removeLabel(lb);
    } catch { /* ignore */ }
    drawn.shapes = [];
    drawn.labels = [];
    for (const m of measurements) {
      try {
        drawn.shapes.push(viewer.addSphere({ center: m.a, radius: 0.45, color: "#f59e0b", opacity: 0.95 }));
        drawn.shapes.push(viewer.addSphere({ center: m.b, radius: 0.45, color: "#f59e0b", opacity: 0.95 }));
        drawn.shapes.push(viewer.addCylinder({ start: m.a, end: m.b, radius: 0.06, color: "#f59e0b", dashed: true }));
        const mid = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2, z: (m.a.z + m.b.z) / 2 };
        drawn.labels.push(viewer.addLabel(`${m.distance.toFixed(2)} Å`, {
          position: mid, backgroundColor: "#0f172a", backgroundOpacity: 0.85,
          fontColor: "#fbbf24", fontSize: 12, borderThickness: 0, inFront: true,
        }));
      } catch { /* ignore */ }
    }
    try { viewer.render(); } catch { /* ignore */ }
  }, [measurements, loading, error]);

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
            onClick={(e) => {
              e.stopPropagation();
              // Inline viewer: measuring needs the big canvas, so jump to
              // fullscreen and auto-start measure there. Fullscreen viewer:
              // toggle measure mode in place.
              if (!isFullscreen && onRequestFullscreenMeasure) onRequestFullscreenMeasure();
              else setMeasureMode((m) => !m);
            }}
            aria-pressed={measureMode}
            title={
              !isFullscreen && onRequestFullscreenMeasure
                ? "Measure distances — opens the viewer fullscreen, then click two atoms."
                : measureMode
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
        {measurements.length > 0 && (
          <div
            className="absolute bottom-12 left-2 z-10 max-w-[70%] text-[10px] font-mono bg-slate-900/90 text-amber-200 rounded px-2 py-1.5 shadow ring-1 ring-amber-500/40"
          >
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-sans font-semibold">
                {measurements.length} measurement{measurements.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  firstAtomRef.current = null;
                  setFirstAtomPicked(false);
                  setMeasurements([]);
                }}
                className="text-[9px] uppercase tracking-wider font-sans font-semibold text-slate-300 hover:text-rose-300 transition-colors"
                title="Clear all measurements"
              >
                ✕ Clear
              </button>
            </div>
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
          showContacts={showContacts}
          setShowContacts={setShowContacts}
          hasContacts={!!contacts && contacts.length > 0}
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
  /** Per-contact-residue side-chain stick visibility. Toggleable so
   *  users can declutter when ProLIF returns 10+ contacts. */
  showContacts: boolean;
  setShowContacts: (b: boolean) => void;
  /** Hide the Contacts toggle entirely when there are no contacts to
   *  toggle (e.g. cell still validating, or ProLIF returned empty). */
  hasContacts: boolean;
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

      {/* Contacts toggle — promoted to its own pill on the LEFT side
          (after Backbone + Pose) so it's visible in narrow inline
          viewers without competing for space with the H / spin / zoom
          icon cluster on the right. Larger hit target than the icon
          toggles so it reads as a labelled action, not a tiny icon. */}
      {p.hasContacts && (
        <div className="flex items-center gap-1 border-l border-slate-200 pl-2 ml-1 dark:border-slate-700">
          <button
            type="button"
            onClick={() => p.setShowContacts(!p.showContacts)}
            title={p.showContacts
              ? "Hide contact side chains (declutter the view)"
              : "Show contact side chains (residues touching the ligand)"}
            className={
              p.showContacts
                ? "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-delta-600 text-white shadow-sm hover:bg-delta-700 transition-colors dark:bg-delta-500 dark:hover:bg-delta-400"
                : "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-colors dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600 dark:hover:bg-slate-700"
            }
          >
            <span aria-hidden className={p.showContacts ? "w-1.5 h-1.5 rounded-full bg-white" : "w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500"} />
            Contacts {p.showContacts ? "on" : "off"}
          </button>
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
