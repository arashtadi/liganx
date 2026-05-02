import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Icons";
import { api, ApiError } from "../api";
import { tryReloadOnChunkError } from "../lib/chunkReload";

/**
 * Mol3DPreview — small (200x200 by default) 3Dmol.js viewer of a
 * gas-phase conformer of a SMILES.
 *
 * Used inside the Ketcher modal's AI sidebar as an OPTIONAL toggle: the
 * user clicks "📐 3D" to expand it next to their 2D drawing. Auto-refreshes
 * on a 1.5s debounce when the SMILES prop changes (the parent already
 * polls Ketcher every 700ms, so the debounce is what stops us hammering
 * the embed endpoint on every interim canvas state).
 *
 * IMPORTANT — what this is NOT:
 *  - It is NOT a docked pose. The conformer is RDKit + UFF in vacuum;
 *    the receptor is not consulted.
 *  - It is NOT a binding prediction. Use Quick dock for that.
 *  - It is NOT a stereochemistry oracle either — RDKit picks one valid
 *    conformer, not an exhaustive search. For chiral centres the user
 *    drew, it'll respect them; for ambiguous ones it'll pick something
 *    chemically reasonable.
 *
 * The host UI (AiSidebar) labels the panel with the "gas-phase, not the
 * docked pose" caveat so users aren't misled.
 */
interface Props {
  /** Current SMILES from the Ketcher canvas. Empty/whitespace = render
   *  the empty-state placeholder. The parent handles read-from-Ketcher. */
  smiles: string;
  /** Side length in pixels. Default 200; the AI sidebar passes this to
   *  match its 320px-wide column. */
  size?: number;
}

// Debounce window for the embed call. Chosen to be longer than the
// parent's 700ms Ketcher poll, so a user mid-edit doesn't trigger a
// fetch every poll cycle. 1.5s is the same window the AI assistant
// uses for its "is this a real intent" debounce — feels like the
// right tempo for "you've stopped editing, now show me the result".
const DEBOUNCE_MS = 1500;

export default function Mol3DPreview({ smiles, size = 200 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // We keep a reference to the live $3Dmol viewer so subsequent SMILES
  // updates can clear+re-add models without re-creating the WebGL
  // context (which is slow and leaks contexts on Chrome's 16-context
  // hard cap).
  const viewerRef = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the SMILES we last rendered so we can skip redundant fetches
  // when the parent re-emits the same string (which happens on every
  // 700ms poll if the canvas hasn't changed).
  const lastRenderedSmilesRef = useRef<string>("");

  // Initialise the viewer once on mount. Ketcher's parent modal owns
  // the iframe lifecycle; the 3D viewer just needs a div with measured
  // dimensions to grab.
  useEffect(() => {
    let cancelled = false;
    let viewer: any = null;

    async function init() {
      if (!containerRef.current) return;
      try {
        // Same lazy-import pattern as StructureViewer/MutationOverlayViewer
        // so 3Dmol is code-split out of the main bundle. The first user
        // who opens the toggle pays the ~600KB download once, then it's
        // cached.
        const mod: any = await import("3dmol");
        const $3Dmol: any = mod.default && Object.keys(mod.default).length > 0 ? mod.default : mod;
        if (cancelled || !containerRef.current) return;
        viewer = $3Dmol.createViewer(containerRef.current, {
          // Transparent background lets the host card colors show through
          // in dark mode without a hard white square. 3Dmol accepts
          // either a hex or "rgba(...)"; rgba is the only way to get
          // alpha=0.
          backgroundColor: "rgba(0,0,0,0)",
          antialias: true,
        });
        viewerRef.current = viewer;
      } catch (e) {
        // Stale-chunk after a redeploy → reload-once helper handles it.
        // Anything else: surface a friendly error.
        const msg = (e as Error)?.message ?? String(e);
        if (tryReloadOnChunkError(msg)) return;
        if (!cancelled) setError(`3D viewer failed to load: ${msg}`);
      }
    }
    init();
    return () => {
      cancelled = true;
      // Best-effort teardown. 3Dmol doesn't expose a clean dispose API,
      // but clearing the container drops the WebGL canvas reference and
      // lets GC reclaim the context.
      try {
        if (viewer && typeof viewer.removeAllModels === "function") {
          viewer.removeAllModels();
        }
        viewerRef.current = null;
      } catch { /* ignore */ }
    };
  }, []);

  // Debounced fetch + render whenever the SMILES prop changes.
  useEffect(() => {
    const trimmed = (smiles || "").trim();
    // Empty canvas → wipe the viewer and clear state. No fetch.
    if (!trimmed) {
      lastRenderedSmilesRef.current = "";
      setError(null);
      try {
        if (viewerRef.current && typeof viewerRef.current.removeAllModels === "function") {
          viewerRef.current.removeAllModels();
          viewerRef.current.render();
        }
      } catch { /* ignore */ }
      return;
    }
    // Same SMILES as last render → skip. The parent's 700ms poll re-emits
    // the same string repeatedly while the canvas is stable; without this
    // guard we'd fire a fetch every poll.
    if (trimmed === lastRenderedSmilesRef.current) return;

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.embedSmiles({ smiles: trimmed, minimise: true });
        if (cancelled) return;
        if (!r.valid || !r.mol_block) {
          setError(r.error || "Couldn't generate a 3D conformer for this structure.");
          setLoading(false);
          return;
        }
        // Render. Clearing first prevents the previous structure from
        // ghosting through during the transition.
        const viewer = viewerRef.current;
        if (!viewer) {
          // Viewer hasn't initialised yet (race with mount). Bail and
          // let the next SMILES change retry — this is rare because
          // initialisation typically completes in <100ms.
          setLoading(false);
          return;
        }
        try {
          viewer.removeAllModels();
          viewer.addModel(r.mol_block, "mol");
          // Stick representation, color by element. This is the standard
          // medchem rendering — sticks make bond order visible (single
          // vs double vs aromatic) and atom-color makes heteroatoms pop
          // (red O, blue N, green Cl, yellow S). Not ball-and-stick:
          // spheres would crowd a 200x200 viewport.
          viewer.setStyle({}, { stick: { radius: 0.15, colorscheme: "default" } });
          viewer.zoomTo();
          viewer.render();
          lastRenderedSmilesRef.current = trimmed;
          setError(null);
        } catch (renderErr) {
          setError(`3D render failed: ${(renderErr as Error)?.message ?? renderErr}`);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? "embed failed";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [smiles]);

  return (
    <div className="space-y-1">
      {/* The viewer container — fixed square, 3Dmol grabs measured
          dimensions at create time. position:relative so the loading
          overlay can absolute-position over it. */}
      <div
        className="relative rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 overflow-hidden"
        style={{ width: size, height: size }}
      >
        <div ref={containerRef} className="absolute inset-0" />
        {/* Loading overlay — semi-transparent so the previous structure
            stays visible underneath while a new one is computing.
            Prevents the "blank flash" feel when SMILES updates rapidly. */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-slate-900/40 pointer-events-none">
            <Spinner size={14} />
          </div>
        )}
        {/* Error overlay — opaque so the broken-state structure doesn't
            confuse the user. Short message; full error is in the title. */}
        {error && !loading && (
          <div
            className="absolute inset-0 flex items-center justify-center text-center px-2 text-[10px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 leading-tight"
            title={error}
          >
            {error}
          </div>
        )}
      </div>
      {/* Honesty caveat — small, muted, but always present. Without
          this users will think the rotating molecule is the docked
          pose. The Quick dock button below the property strip is the
          right tool for that. */}
      <div className="text-[9px] text-slate-400 dark:text-slate-500 leading-tight px-0.5">
        Gas-phase conformer (UFF). Not the docked pose.
      </div>
    </div>
  );
}
