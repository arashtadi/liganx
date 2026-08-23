/**
 * ProductionViewer3D — extracted from StudioPage.tsx during the R5
 * robustness pass (5,900-line monster → carve up). Owns BOTH the
 * pre-dock live-conformer preview and the post-dock receptor+pose
 * overlay in a single 3Dmol GLViewer instance.
 *
 * Only two outside references: `api.assistConformer` (the conformer
 * fetch) and the QuickDockResult type. Everything else — the variant
 * toggle, the segmented control helpers, the styling logic — is local.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import type { QuickDockResult } from "../../types/studio";

/** Production Viewer3D — unified interface using JobPage production components.
 *
 *  Reuses MutationOverlayViewer and DockedPoseViewer instead of custom inline code.
 *
 *    SMILES change (polled every 700ms from Ketcher)
 *      → debounce 350ms (avoid spamming the conformer endpoint while drawing)
 *      → POST /assist/conformer → SDF text (~100-200ms backend RDKit)
 *      → 3Dmol.js parses SDF, replaces the model in the existing scene
 *      → camera position is preserved across updates (no jarring resets)
 *
 *  Once a Quick Dock completes, this same viewer switches into "docked
 *  pose" mode: it shows the receptor (cartoon) + the docked ligand
 *  (sticks) instead of the loose conformer. Switching is automatic when
 *  `dockResult` arrives.
 *
 *  The viewer is lazy-loaded via `import("3dmol")` to keep the initial
 *  bundle small (3Dmol is ~600KB). The first SMILES change pays a one-
 *  time ~300ms cost; subsequent updates are fast.
 *
 *  Smoothness invariants:
 *   - We mount the GLViewer ONCE per component lifetime. Updates call
 *     viewer.removeAllModels() + addModel() + render() — never destroy/
 *     recreate the canvas.
 *   - Camera state (rotation/zoom) is preserved by NOT calling zoomTo()
 *     after the first model. The user's view stays put as the molecule
 *     morphs.
 *   - The conformer fetch is debounced AND deduped — if the same SMILES
 *     is asked twice, the second request short-circuits.
 */
/** Self-contained 3D viewer for Studio. Uses the same proven 3Dmol pattern
 *  as LiveConformerPlaceholder (which renders correctly) — no delegation to
 *  DockedPoseViewer (which is the kind of code path that produced an
 *  invisible canvas in v0.16/v0.16.1).
 *
 *  Pre-dock: shows the live SMILES conformer (re-fetched on edit, debounced).
 *  Post-dock: fetches the cleaned receptor PDB and overlays the docked
 *  ligand pose. Camera frames the pose centroid when available, else the
 *  whole receptor.
 */
type BackboneStyle = "cartoon" | "surface" | "line" | "hide";
type PoseStyle = "stick" | "ball" | "line" | "sphere";

export default function ProductionViewer3D({
  smiles,
  dockResult,
  dockResultWt,
  mutation,
  targetMeta,
}: {
  smiles: string;
  dockResult: QuickDockResult | null;
  dockResultWt: QuickDockResult | null;
  mutation: string | null;
  targetMeta: any;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const measurePicksRef = useRef<Array<{ x: number; y: number; z: number }>>([]);
  // SMILES that produced the current dockResult.pose. When the user edits
  // the 2D editor, currentSmiles diverges from this and we swap the docked
  // pose for a live conformer of the new structure (positioned at the
  // pocket center). Re-dock writes a new value and we go back to the
  // crystal-style docked pose. Stored in a ref so editing doesn't loop
  // through React state updates.
  const dockedSmilesRef = useRef<string>("");
  const [conformerSdf, setConformerSdf] = useState<string | null>(null);
  const [conformerErr, setConformerErr] = useState<string | null>(null);
  // (v1.28) SDF of the conformer most recently produced for this viewer.
  // Passed to /assist/conformer as `prev_sdf` on the next fetch so the
  // backend superimposes the new conformer onto it over their common
  // substructure — without this, every 2D edit re-embeds the molecule in
  // a fresh arbitrary ETKDG orientation and the live 3D view appears to
  // spin/resize even though the user only added one bond. A ref (not
  // state) so updating it never triggers a re-render or rebuild.
  const lastConformerSdfRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  // (v0.53) Both receptors fetched eagerly so the variant toggle is
  // a style change, not a fetch+rebuild. Computed values below derive
  // the "primary" and "alt" slots based on the current viewVariant for
  // backward compat with the existing build/style code.
  const [receptorPdbWt, setReceptorPdbWt] = useState<string | null>(null);
  const [receptorPdbMut, setReceptorPdbMut] = useState<string | null>(null);
  const [receptorErr, setReceptorErr] = useState<string | null>(null);
  // Live preview SMILES — set when currentSmiles diverges from the last
  // docked SMILES. Drives the conformer fetch + overlay logic below so
  // the 3D view reflects 2D edits without requiring a re-dock.
  const [editedConformerSdf, setEditedConformerSdf] = useState<string | null>(null);

  // (bugfix) Which SMILES the cached `conformerSdf` was produced for.
  // Without this, the conformer-fetch effect's "we already have a cached
  // SDF, no need to fetch" short-circuit was firing across SMILES changes
  // — so when the user clicked a different staged compound (pre-dock,
  // viewMode=live), the 3D viewer kept rendering the previous compound's
  // conformer. Capturing the source SMILES makes the cache check correct.
  const conformerSdfForRef = useRef<string | null>(null);

  // Visual controls (mirrored from MutationOverlayViewer's toolbar). These
  // cover the 80%-case knobs a user wants when inspecting a docked pose:
  //   • backbone — cartoon (default), surface (pocket shape), line (X-ray-
  //     style), hide (pose-only). Sphere/spacefill is skipped — too heavy
  //     to render at our panel size and rarely useful for kinase work.
  //   • pose style — stick / ball-and-stick / line / sphere. Stick is the
  //     research default; ball is friendlier for outreach screenshots.
  //   • contacts — toggle the binding-pocket residue side chains.
  //   • measure — click two atoms to get distance in Å.
  // Default to line (wireframe) — matches the JobPage view users are
  // already familiar with, and keeps the receptor from occluding the
  // docked ligand. Cartoon is one click away on the toolbar for users
  // who want the publication-style ribbon view.
  const [backboneStyle, setBackboneStyle] = useState<BackboneStyle>("line");
  const [poseStyle, setPoseStyle] = useState<PoseStyle>("stick");
  const [showContacts, setShowContacts] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [measureDistance, setMeasureDistance] = useState<number | null>(null);
  // Bumped every time createViewer runs. Click-handler / style effects
  // depend on this so they re-bind to the FRESH 3Dmol instance after a
  // rebuild (data change). Without this, measure mode silently lost its
  // click handler whenever a re-dock or 2D edit triggered a viewer
  // recreate.
  const [viewerVersion, setViewerVersion] = useState(0);
  // Fullscreen toggle — when true, the 3D panel covers the entire
  // viewport (escape key exits). Lets users zoom into atomic detail
  // without leaving the page. Same affordance as JobPage's hero viewer.
  const [fullscreen, setFullscreen] = useState(false);
  // (v0.29) View mode toggle. After a dock completes, the viewer
  // auto-switches to the docked-pose scene (receptor + bound ligand),
  // which is usually what the user wants — but sometimes they want to
  // pop back to the loose live conformer (e.g. while editing a follow-
  // up compound to compare unbound geometry vs. the docked pose). This
  // state lets the user override the default. Resets to "dock" each
  // time a fresh dockResult arrives so the new dock takes the spotlight.
  const [viewMode, setViewMode] = useState<"live" | "dock">("dock");
  // (v0.50) Variant toggle. Three states: "wt", "both", "mut". Both
  // mode overlays the WT and mutant receptors + poses in one scene
  // with distinct colors and opacity so the user can compare the
  // side-chain shift and pose differences side-by-side. "mut" is
  // the default (new biology) and auto-snaps back when a fresh
  // mutant result lands. WT-only runs default the view to "wt".
  const [viewVariant, setViewVariant] = useState<"wt" | "both" | "mut">("mut");
  useEffect(() => {
    if (dockResult) setViewVariant("mut");
    else if (dockResultWt && !dockResult) setViewVariant("wt");
  }, [dockResult, dockResultWt]);
  // (v0.53) Primary receptor = whichever the current viewVariant
  // points at. Alt = the OTHER one (used by 'both' mode for the
  // overlay). Both already in state; we just pick which slot is which
  // based on the current view.
  const receptorPdb = viewVariant === "wt" ? receptorPdbWt : receptorPdbMut;
  const receptorPdbAlt = viewVariant === "wt" ? receptorPdbMut : receptorPdbWt;

  // (v0.43) Pick which dock result drives the scene based on viewVariant.
  // Falls back gracefully when one of the two slots is empty (single-
  // variant runs default to whichever slot has a result).
  const activeDockResult = viewVariant === "wt"
    ? (dockResultWt || dockResult)
    : (dockResult || dockResultWt);
  const primary = activeDockResult;
  // pdbId/chain used to drive the (now-removed) primary-only receptor
  // fetch; replaced in v0.53 by the dual-fetch effects above. Kept the
  // variant string because it's used to color the primary receptor in
  // applyStyles (WT slate vs mutant amber).
  const variant = viewVariant === "wt" ? "WT" : (mutation || "WT");
  const hasDock = !!primary;
  // Vina returns multiple binding modes in one PDBQT (MODEL 1 ... ENDMDL ·
  // MODEL 2 ... etc — up to 9 by default). 3Dmol's addModel concatenates
  // all of them into a single model with 9× the atoms scattered across
  // space, which broke camera framing — zoomTo({model:1}) fit the bbox
  // of all 9 modes, leaving each individual mode tiny in the viewport.
  // Strip everything after the first ENDMDL so only the top-ranked pose
  // (mode 1, the one matching the score) is rendered.
  const posePdbqtFull = activeDockResult?.pose_pdbqt_b64 ? atob(activeDockResult.pose_pdbqt_b64) : "";
  // Convert PDBQT → simplified PDB before passing to 3Dmol. Two reasons:
  //   1. PDBQT contains up to 9 binding modes (MODEL/ENDMDL blocks). We
  //      only want mode 1 — the one whose score matches the panel.
  //   2. PDBQT's BRANCH / ENDBRANCH / ROOT / ENDROOT torsion-tree
  //      markers confuse 3Dmol's pdbqt parser — verified empirically:
  //      a 38-atom ligand only renders as a single OH fragment when
  //      passed as 'pdbqt' format, but renders fully when passed as
  //      'pdb'. We strip the AutoDock-specific markers and trailing
  //      charge/type columns, leaving plain PDB ATOM lines.
  const posePdbqt = (() => {
    if (!posePdbqtFull) return "";
    const endIdx = posePdbqtFull.indexOf("ENDMDL");
    const mode1 = endIdx >= 0 ? posePdbqtFull.slice(0, endIdx) : posePdbqtFull;
    const lines: string[] = [];
    for (const raw of mode1.split("\n")) {
      const line = raw.replace(/\r$/, "");
      // Keep only ATOM/HETATM lines; drop ROOT, ENDROOT, BRANCH, ENDBRANCH,
      // TORSDOF, REMARK, MODEL, etc. Trim PDBQT extras after column 66
      // (the standard PDB occupancy/B-factor fields end there) and append
      // an element guess so 3Dmol colors atoms correctly.
      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        const trimmed = line.slice(0, 66).padEnd(66, " ");
        // Atom name is in cols 13-16 (1-indexed) = JS 12-16. Take the
        // first letter of the trimmed name as the element. AutoDock
        // names like "OA", "NA" map to O, N.
        const name = line.slice(12, 16).trim();
        const element = name.replace(/^[0-9]+/, "")[0] || "C";
        // (U24) Skip hydrogens. AutoDock PDBQT retains polar H; the
        // results-page /poses endpoint strips ALL H (obabel -d) so the
        // two viewers render the SAME heavy-atom representation. Drop
        // H here too so Studio and the results page always match, for
        // every ligand — not just ones whose PDBQT happens to be H-free.
        if (element === "H") continue;
        lines.push(trimmed + "          " + element.padStart(2, " "));
      }
    }
    return lines.join("\n") + "\nEND\n";
  })();
  const hasPose = hasDock && !!posePdbqt;
  // (v1.27) Centroid of the docked pose, in receptor PDB coordinates.
  // Used to translate the live-conformer overlay into the binding
  // pocket when the user edits / loads a compound after a dock.
  //
  // This MUST be a pure derivation of posePdbqt — NOT computed in an
  // effect gated on `smiles`. The old code computed it inside the
  // dockedSmilesRef snapshot effect, which only ran its body when
  // `smiles` was truthy. On a history-load the dock result arrives
  // before Ketcher reports a SMILES, so the centroid never got
  // computed → poseCentroidRef stayed null → the conformer rendered
  // at RDKit's (0,0,0) origin, floating far from the PDB-coordinate
  // receptor. (That's the "ligand way off to the side" bug.)
  const poseCentroid = useMemo<[number, number, number] | null>(() => {
    if (!posePdbqt) return null;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const ln of posePdbqt.split("\n")) {
      if (!ln.startsWith("ATOM") && !ln.startsWith("HETATM")) continue;
      const x = parseFloat(ln.slice(30, 38));
      const y = parseFloat(ln.slice(38, 46));
      const z = parseFloat(ln.slice(46, 54));
      if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
        sx += x; sy += y; sz += z; n++;
      }
    }
    return n > 0 ? [sx / n, sy / n, sz / n] : null;
  }, [posePdbqt]);
  // (v0.50) Alternate pose for "both" mode — the variant NOT currently
  // active. Same PDBQT→PDB conversion as the primary so 3Dmol's stable
  // 'pdb' parser handles all atoms (BRANCH atoms get dropped by the
  // pdbqt parser). Empty string when "both" isn't active or the alt
  // dock has no parseable pose.
  const altDockResult = viewVariant === "both"
    ? (variant === "WT" ? dockResult : dockResultWt)
    : null;
  const altPosePdbqtFull = altDockResult?.pose_pdbqt_b64 ? atob(altDockResult.pose_pdbqt_b64) : "";
  const altPosePdbqt = (() => {
    if (!altPosePdbqtFull) return "";
    const endIdx = altPosePdbqtFull.indexOf("ENDMDL");
    const mode1 = endIdx >= 0 ? altPosePdbqtFull.slice(0, endIdx) : altPosePdbqtFull;
    const lines: string[] = [];
    for (const raw of mode1.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        const trimmed = line.slice(0, 66).padEnd(66, " ");
        const name = line.slice(12, 16).trim();
        const element = name.replace(/^[0-9]+/, "")[0] || "C";
        lines.push(trimmed + "          " + element.padStart(2, " "));
      }
    }
    return lines.join("\n") + "\nEND\n";
  })();
  // Effective scene flag — drives the data-load effect and the
  // applyStyles branches. When the user has flipped the toolbar to
  // "live" we deliberately downgrade to the conformer-only path so
  // the receptor + pose disappear and the unbound ligand snaps to its
  // RDKit ETKDG geometry. The hasDock variable above is kept honest
  // so the score panel and other UI remain accurate.
  const showDockedScene = hasDock && viewMode === "dock";
  // Live-preview gate: true when the current 2D structure is NOT the
  // one this docked pose belongs to. While true, the 3D view shows a
  // live conformer of the edited SMILES instead of the stale pose.
  //
  // (v1.27) The docked SMILES now comes straight off the dock result
  // object (activeDockResult.smiles, stamped at every setDockResult
  // site). This is DETERMINISTIC — no timing. The old approach inferred
  // it from dockedSmilesRef, which was written by an effect that raced
  // with loadIntoCanvas: picking a compound from history or hitting
  // "modify compound" would either snapshot the ref too early (stale)
  // or too late (matched the new smiles → looked un-edited → 3D stayed
  // on the old pose). dockedSmilesRef is kept ONLY as a fallback for
  // pre-v1.27 dock results / restored sessions that have no .smiles.
  const dockedSmiles = activeDockResult?.smiles ?? dockedSmilesRef.current;
  const smilesEdited = hasDock && !!smiles && !!dockedSmiles && smiles !== dockedSmiles;

  // Hits = pocket-contact residues from the dock result. Used to highlight
  // side chains and to decide whether to enable the Contacts toggle.
  // (v0.43) Track the ACTIVE dock result so flipping the variant toggle
  // updates the highlighted contacts to match the displayed pose.
  const contactResnums = useMemo<number[]>(() => {
    const hits = (activeDockResult?.hits || []) as string[];
    const out = new Set<number>();
    for (const h of hits) {
      const m = String(h).match(/(\d+)/);
      if (m) out.add(Number(m[1]));
    }
    return Array.from(out);
  }, [activeDockResult?.hits]);

  // (v0.29) When a fresh dockResult lands, default the view back to
  // the docked-pose scene. If the user manually flipped to "live"
  // before the next dock finished, we still want the new dock to
  // get the spotlight — they can flip back with one click.
  useEffect(() => {
    if (dockResult) setViewMode("dock");
  }, [dockResult]);

  // (v1.31) ...and the converse: when there's no dock result at all
  // (e.g. the user clicked a failed compound row, which now feeds the
  // viewer `null` instead of a phantom poseless result), force the
  // header back to "live". Without this, viewMode could be stuck on
  // "dock" from a previous selection while hasDock is false — the
  // header said "docked" but there was no pose, and the scene fell
  // back to the live conformer anyway. The label now matches reality.
  useEffect(() => {
    if (!hasDock) setViewMode("live");
  }, [hasDock]);

  // When a fresh dock arrives, clear any stale live-preview conformer
  // so the new docked pose takes the scene. (Edit-detection itself is
  // now deterministic via activeDockResult.smiles — see smilesEdited
  // above — and the pocket centroid is a useMemo on posePdbqt, so this
  // effect no longer owns either of those; it just resets the preview.)
  useEffect(() => {
    setEditedConformerSdf(null);
    // Keep dockedSmilesRef populated as a fallback for pre-v1.27 dock
    // results that have no .smiles stamped on them.
    if (hasDock && smiles && posePdbqt) {
      dockedSmilesRef.current = smiles;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockResult, dockResultWt]);

  // Fetch the live conformer in three cases:
  //   1. No dock yet — preview whatever the user is sketching.
  //   2. Dock done but the user has since edited the 2D structure —
  //      preview the new compound in the pocket so they can see how
  //      their edit fits before re-docking.
  //   3. (v0.29) User flipped the live/dock toggle to "live" while a
  //      dock exists — they want to see the unbound conformer of the
  //      docked compound. Skip the fetch if we already have a
  //      conformer for this SMILES (cached in conformerSdf).
  useEffect(() => {
    if (!smiles) return;
    if (hasDock && !smilesEdited && viewMode !== "live") return;  // docked pose is still current
    // (v0.30) Only short-circuit live-mode caching if the SMILES is
    // unchanged since the cached conformer was produced. After an edit
    // we MUST re-fetch — otherwise the live preview stays glued to the
    // pre-edit geometry. The smilesEdited flag handles the docked case
    // ("SMILES has diverged from the docked pose's SMILES"). For the
    // pre-dock case, smilesEdited is always false, so we additionally
    // require the cached conformer was generated FOR this same SMILES.
    // Without that check, switching staged compounds (or modifying the
    // 2D canvas) left the 3D viewer stuck on the previous conformer.
    if (
      viewMode === "live"
      && !smilesEdited
      && conformerSdf
      && conformerSdfForRef.current === smiles
    ) return;
    const t = window.setTimeout(async () => {
      setLoading(true);
      setConformerErr(null);
      try {
        // Pass the conformer currently on screen so the backend can
        // overlay the new one onto it (MCS alignment) — keeps the live
        // viewer from tumbling the whole molecule on small 2D edits.
        const res = await api.assistConformer(smiles, lastConformerSdfRef.current);
        if (res.ok && res.sdf) {
          // Remember this geometry as the alignment anchor for the next edit.
          lastConformerSdfRef.current = res.sdf;
          if (smilesEdited) {
            setEditedConformerSdf(res.sdf);
          } else {
            setConformerSdf(res.sdf);
            // (bugfix) Stamp the SMILES this conformer corresponds to so
            // the bail check above is correct on the next render.
            conformerSdfForRef.current = smiles;
          }
        } else {
          setConformerErr(res.error || "Conformer failed");
        }
      } catch (e: any) {
        setConformerErr(e?.message || "Conformer request failed");
      } finally {
        setLoading(false);
      }
    }, 200);  // v1.27 — tightened from 350ms so 3D follows 2D edits faster.
    return () => window.clearTimeout(t);
    // viewMode + conformerSdf in deps so flipping to "live" triggers a
    // fetch when we don't already have a cached conformer for this
    // SMILES. eslint-disable: conformerSdf is intentionally read inside
    // the early-return so the rule doesn't see a hooks-rules violation,
    // but TS sees it as a non-deps usage. Manual list keeps the rebuild
    // count minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smiles, hasDock, smilesEdited, viewMode]);

  // (v0.53) Fetch the WT receptor whenever we have a WT dock result.
  // Independent of viewVariant — both receptors stay loaded so the
  // variant toggle is pure-style with no rebuild.
  useEffect(() => {
    if (!dockResultWt) { setReceptorPdbWt(null); return; }
    const wtPdb = dockResultWt.pdb_id || targetMeta?.pdb_id;
    const wtChain = dockResultWt.chain || targetMeta?.chain || "A";
    if (!wtPdb || !wtChain) return;
    let cancelled = false;
    setReceptorErr(null);
    api
      .structure(wtPdb, wtChain, "WT")
      .then((text) => {
        if (cancelled) return;
        if (!text || text.length < 100) return;
        setReceptorPdbWt(text);
      })
      .catch((e: Error) => {
        if (!cancelled) setReceptorErr(`WT receptor fetch failed: ${e.message}`);
      });
    return () => { cancelled = true; };
  }, [dockResultWt, targetMeta?.pdb_id, targetMeta?.chain]);

  // (v0.53) Mirror for the mutant receptor. Fetched only when there's
  // a mutant dock result AND the user actually selected a mutation
  // (mutation prop non-empty); otherwise the "mutant" structure
  // doesn't exist as a distinct PDB.
  useEffect(() => {
    if (!dockResult || !mutation) { setReceptorPdbMut(null); return; }
    const mPdb = dockResult.pdb_id || targetMeta?.pdb_id;
    const mChain = dockResult.chain || targetMeta?.chain || "A";
    if (!mPdb || !mChain) return;
    let cancelled = false;
    api
      .structure(mPdb, mChain, mutation)
      .then((text) => {
        if (cancelled) return;
        if (!text || text.length < 100) return;
        setReceptorPdbMut(text);
      })
      .catch(() => { /* mutant fetch is best-effort */ });
    return () => { cancelled = true; };
  }, [dockResult, mutation, targetMeta?.pdb_id, targetMeta?.chain]);

  // Apply visual styles based on toolbar state. This is the single place
  // styles are written to the 3Dmol viewer — both the data-load effect
  // (below) and the toolbar buttons trigger it via dependency.
  function applyStyles(viewer: any) {
    if (!viewer) return;
    try {
      // Receptor model — index 0. Conformer-only mode (no dock OR user
      // flipped to "live") skips this whole branch.
      if (showDockedScene && receptorPdb) {
        viewer.setStyle({ model: 0 }, {});
        try { viewer.removeAllSurfaces(); } catch { /* */ }
        // (v0.52) Color-code the receptor so the user can tell at a
        // glance whether they're looking at WT or the mutant.
        // - WT  → slate (#94a3b8) — neutral, the baseline.
        // - Mut → amber (#f59e0b) — warm, matches the score panel's
        //         amber-accented mutant column. In "both" mode this
        //         also distinguishes the two receptors when stacked.
        const recColor = variant === "WT" ? "#94a3b8" : "#f59e0b";
        if (backboneStyle === "cartoon") {
          viewer.setStyle({ model: 0 }, { cartoon: { color: recColor } });
        } else if (backboneStyle === "line") {
          viewer.setStyle({ model: 0 }, { line: { color: recColor } });
        } else if (backboneStyle === "surface") {
          viewer.setStyle({ model: 0 }, { cartoon: { color: recColor, opacity: 0.45 } });
          try { viewer.addSurface(2, { opacity: 0.55, color: "#475569" }, { model: 0 }); } catch { /* */ }
        }
        // hide: leave receptor empty
        // Side-chain sticks at pocket-contact residues.
        if (showContacts && contactResnums.length > 0) {
          for (const rn of contactResnums) {
            const sel = { model: 0, resi: rn, atom: ["CA","CB","CG","CG1","CG2","CD","CD1","CD2","CE","CE1","CE2","CZ","NE","NE1","NE2","NZ","NH1","NH2","ND1","ND2","OD1","OD2","OE1","OE2","OG","OG1","OH","SG","SD"] };
            try { viewer.addStyle(sel, { stick: { color: "#0ea5e9", radius: 0.18 } }); } catch { /* */ }
          }
        }
        // Mutation residue side chain — emerald green, fat radius. Matches
        // MutationOverlayViewer's color convention (WT side chain green,
        // mutant blue) so users coming from JobPage immediately recognize
        // 'green = the mutation'. Critically, green is distinct from any
        // common atom element color (no element renders green by default
        // except F/Cl), so it can't be confused with the docked ligand.
        // (v0.55) Mutation-residue side chain — color follows the
        // MutationOverlayViewer convention so users coming from JobPage
        // get the same visual mapping:
        //   • WT residue side chain  → emerald green (#10b981)
        //   • Mutant residue side chain → blue       (#3b6cf6)
        // This is what makes wt vs mut visually obvious in the close-
        // up viewer — the protein chain line color (slate vs amber) is
        // a wider-context cue, but the user looks at the side chain
        // because that's where the chemistry is. Without distinct
        // colors, both views looked 'green' which the user reported
        // as "WT and Q61H are the same color".
        if (mutation) {
          const m = String(mutation).match(/(\d+)/);
          if (m) {
            const rn = Number(m[1]);
            const sel = { model: 0, resi: rn };
            const sideColor = variant === "WT" ? "#10b981" : "#3b6cf6";
            try { viewer.addStyle(sel, { stick: { color: sideColor, radius: 0.32 } }); } catch { /* */ }
          }
        }
      }
      // Pose model (last loaded). With receptor: model:1. Without dock,
      // the conformer is at model:0. The edited-preview path also lives
      // at model:1 so the same selector covers it. (v0.29) Mirror the
      // showDockedScene flag here too — when the user picks "live"
      // there's no receptor in the scene, so the conformer is at 0.
      const poseIdx = showDockedScene && receptorPdb ? 1 : 0;
      const ligandPresent = (showDockedScene && (hasPose || (smilesEdited && editedConformerSdf))) || (!showDockedScene && conformerSdf);
      if (ligandPresent) {
        viewer.setStyle({ model: poseIdx }, {});
        // Thick element-colored ligand (radius 0.30) — same visual weight
        // as JobPage's MutationOverlayViewer, so the ligand reads as the
        // hero of the scene against either cartoon or wireframe receptor.
        // Element colors mean N=blue, O=red, F=green, Cl=green, etc —
        // standard chemistry-paper convention.
        if (poseStyle === "stick") {
          viewer.setStyle({ model: poseIdx }, { stick: { radius: 0.30, colorscheme: "Jmol" } });
        } else if (poseStyle === "ball") {
          viewer.setStyle({ model: poseIdx }, { stick: { radius: 0.20, colorscheme: "Jmol" }, sphere: { scale: 0.36 } });
        } else if (poseStyle === "line") {
          viewer.setStyle({ model: poseIdx }, { line: { colorscheme: "Jmol" } });
        } else if (poseStyle === "sphere") {
          viewer.setStyle({ model: poseIdx }, { sphere: { colorscheme: "Jmol" } });
        }
      }
      // (v0.50) Style the alt receptor + alt pose when in "both" mode.
      // Models 2 (alt receptor) and 3 (alt pose) live above the primary
      // receptor=0 + primary pose=1 indices. Alt receptor uses cartoon
      // with reduced opacity so the primary still reads as the focus
      // structure; alt pose gets a flat color (variant-specific) so the
      // user can tell the two ligand poses apart at a glance.
      if (viewVariant === "both" && receptorPdbAlt) {
        const altRecIdx = 2;
        // (v0.54) Alt receptor color matches the variant convention:
        // primary mutant → alt = WT slate; primary WT → alt = mutant
        // amber. Always rendered at 0.45 opacity so the primary stays
        // dominant. Backbone style mirrors the primary's so they
        // visually compare apples-to-apples — when the primary is
        // wireframe, the alt is wireframe too, just in the alt color.
        // Without this match, primary line + alt cartoon made the alt
        // ribbon visually drown out the primary and they appeared as
        // 'one' colored protein.
        const altRecColor = variant === "WT" ? "#f59e0b" : "#94a3b8";
        viewer.setStyle({ model: altRecIdx }, {});
        if (backboneStyle === "cartoon") {
          viewer.setStyle({ model: altRecIdx }, { cartoon: { color: altRecColor, opacity: 0.45 } });
        } else if (backboneStyle === "line") {
          viewer.setStyle({ model: altRecIdx }, { line: { color: altRecColor } });
        } else if (backboneStyle === "surface") {
          viewer.setStyle({ model: altRecIdx }, { cartoon: { color: altRecColor, opacity: 0.30 } });
        }
        // (v0.55) Alt receptor's mutation-residue side chain. In 'both'
        // mode this gives the user both WT (emerald) AND mutant (blue)
        // side chains visible at once — the visual payoff for the mode.
        // Color is the OPPOSITE of whatever the primary side chain
        // got, since the alt is by definition the other variant.
        if (mutation) {
          const m = String(mutation).match(/(\d+)/);
          if (m) {
            const rn = Number(m[1]);
            const altSel = { model: altRecIdx, resi: rn };
            const altSideColor = variant === "WT" ? "#3b6cf6" : "#10b981";
            try { viewer.addStyle(altSel, { stick: { color: altSideColor, radius: 0.32 } }); } catch { /* */ }
          }
        }
        // (v0.54) Alt pose intentionally NOT rendered — see build
        // effect comment. Showing two ligand copies looked like a
        // duplicated compound to the user; the score panel's Δ
        // already communicates pose-energy difference numerically.
      }
      viewer.render();
    } catch { /* defensive — ignore style errors */ }
  }

  // Build the scene when underlying DATA changes, then apply styles. To
  // avoid teardown-and-rebuild flicker on every parent re-render (the page
  // header's UTC clock alone ticks every second), we compare a content
  // signature against the last build. If nothing meaningful changed, skip
  // the rebuild entirely — the existing 3Dmol viewer keeps the user's
  // rotation/zoom state and continues to render. This is what was causing
  // the 'molecule disappears and comes back' artefact during drag.
  const lastBuildKeyRef = useRef<string>("");
  // (v0.58) Single snapshot of the dock-result fingerprints. The
  // build effect uses this to decide whether to re-frame the camera
  // (only when fingerprints differ — i.e. a NEW dock arrived). All
  // other rebuild causes (SMILES edits, conformer fetches, variant
  // flips, live↔docked toggles) preserve the user's camera state.
  const lastStructuralSnapshotRef = useRef<string>("");
  useEffect(() => {
    if (!containerRef.current) return;
    const buildKey = [
      // (v0.29) Use showDockedScene instead of hasDock so flipping the
      // live/dock toggle invalidates the cached scene and triggers a
      // rebuild. Without this the toggle would have no visible effect.
      showDockedScene ? "D" : "_",
      receptorPdb ? `r${receptorPdb.length}` : "_",
      posePdbqt ? `p${posePdbqt.length}` : "_",
      conformerSdf ? `c${conformerSdf.length}` : "_",
      smilesEdited && editedConformerSdf ? `e${editedConformerSdf.length}` : "_",
      // (v0.43) Variant in the key so flipping wt/mut/both forces a rebuild.
      `v${viewVariant}`,
      // (v0.50) Alt receptor + alt pose for "both" mode. Empty in other modes.
      viewVariant === "both" && receptorPdbAlt ? `a${receptorPdbAlt.length}` : "_",
      viewVariant === "both" && altPosePdbqt ? `q${altPosePdbqt.length}` : "_",
    ].join("|");
    if (buildKey === lastBuildKeyRef.current && viewerRef.current) {
      // Same data, viewer already exists — leave it alone.
      return;
    }
    // (v0.58) Generalised camera-preserve. Previously the camera was
    // only kept stable on variant flips (v0.52), but the same problem
    // applies whenever we rebuild the scene without changing the
    // underlying STRUCTURE — e.g. a SMILES edit that fetches an
    // edited conformer, a live/dock toggle, or a variant flip. The
    // user reported camera jumps on every 2D edit even after the
    // variant fix.
    //
    // New rule: capture viewer.getView() before rebuild and restore
    // it after, EXCEPT when one of the dock-result fingerprints just
    // changed (a fresh dock arrived → user expects re-framing on the
    // new pose centroid). Conformer-only / edited-conformer / variant
    // / mode changes all preserve camera.
    // (v0.61) Snapshot includes receptor + conformer presence too.
    // The previous snapshot was just the dock-result fingerprints,
    // which fired the "fresh structure" path the moment dockResult
    // arrived — but the receptor PDB fetches in a SEPARATE effect
    // and lands a few hundred ms later. By the time the receptor
    // arrived and the build effect re-fired, the snapshot was
    // unchanged → camera preserved at the conformer view → the
    // ligand was off-screen until the user manually zoomed.
    //
    // Now the snapshot also tracks receptor lengths and conformer
    // length, so the first time receptor or conformer data lands,
    // it counts as a structural change and the build effect
    // auto-frames on the new pose. Variant flip is unaffected
    // because both receptor lengths stay constant in state.
    const structuralSnapshot = [
      showDockedScene ? "D" : "L",
      dockResult?.pose_pdbqt_b64 || "_",
      dockResultWt?.pose_pdbqt_b64 || "_",
      receptorPdbWt?.length || 0,
      receptorPdbMut?.length || 0,
      conformerSdf?.length || 0,
    ].join("|");
    const isFreshStructure = lastStructuralSnapshotRef.current !== structuralSnapshot;
    let savedView: any = null;
    if (!isFreshStructure && viewerRef.current && typeof viewerRef.current.getView === "function") {
      try { savedView = viewerRef.current.getView(); } catch { /* no-op */ }
    }
    lastStructuralSnapshotRef.current = structuralSnapshot;
    lastBuildKeyRef.current = buildKey;
    let cancelled = false;
    (async () => {
      try {
        const mod: any = await import("3dmol");
        const $3Dmol: any = mod?.default ?? mod?.$3Dmol ?? mod;
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        const viewer = $3Dmol.createViewer(containerRef.current, {
          backgroundColor: "#0f172a",
          antialias: true,
        });
        viewerRef.current = viewer;
        // Tell dependents (measure-mode click binder, style effect) that
        // the viewer instance is brand new and they need to re-bind.
        setViewerVersion((v) => v + 1);

        if (showDockedScene && receptorPdb) {
          viewer.addModel(receptorPdb, "pdb");
          // Choose what to render as the ligand model:
          //   • smilesEdited + we have a fresh conformer → show the edit
          //     translated to the pocket centroid (live preview).
          //   • else if the dock returned a pose → show the docked pose.
          //   • else → no ligand.
          const useEditedPreview = smilesEdited && !!editedConformerSdf;
          if (useEditedPreview) {
            const m = viewer.addModel(editedConformerSdf!, "sdf");
            // Re-position the conformer at the pocket centroid. RDKit's
            // ETKDG conformer is centered around (0,0,0); the receptor
            // lives in PDB coords. Translate by (poseCentroid − conformer
            // centroid) so the new compound sits where the docked pose was.
            try {
              const atoms = m.selectedAtoms ? m.selectedAtoms({}) : [];
              if (atoms.length && poseCentroid) {
                let cx = 0, cy = 0, cz = 0;
                for (const a of atoms) { cx += a.x; cy += a.y; cz += a.z; }
                cx /= atoms.length; cy /= atoms.length; cz /= atoms.length;
                const [px, py, pz] = poseCentroid;
                if (typeof m.translate === "function") {
                  m.translate(px - cx, py - cy, pz - cz);
                } else {
                  for (const a of atoms) { a.x += px - cx; a.y += py - cy; a.z += pz - cz; }
                }
              }
            } catch { /* fallback to native conformer position */ }
          } else if (posePdbqt) {
            // We pre-converted PDBQT to PDB-format ATOM lines above, so
            // load with format 'pdb'. 3Dmol's pdbqt parser drops BRANCH
            // atoms (verified: only ROOT atoms render with 'pdbqt'), so
            // we strip the AutoDock markers and use the well-tested PDB
            // parser instead.
            viewer.addModel(posePdbqt, "pdb");
          }
          // (v0.50) "Both" mode — overlay the alternate receptor and
          // pose. Models added here become indices 2 and 3 (after the
          // primary receptor=0 and primary pose=1). applyStyles below
          // detects them via altModels and renders the alt receptor in
          // slate at 0.45 opacity and the alt pose with a flat color
          // (cyan-ish) so it's distinguishable from the Jmol-coloured
          // primary pose.
          // (v0.54) "Both" mode loads ONLY the alternate receptor —
          // not the alt pose. Showing two ligand copies (primary +
          // alt poses) read as a duplicated compound to the user
          // because the WT and mutant docked-pose centroids are
          // typically <1Å apart. The biology the user actually wants
          // to see in 'both' mode is the side-chain shift at the
          // mutation residue — that's encoded in the receptor, not
          // the ligand. The score panel's Δ column already conveys
          // the pose-energy difference numerically.
          if (viewVariant === "both" && receptorPdbAlt) {
            viewer.addModel(receptorPdbAlt, "pdb");
          }
          // Camera framing — IMPORTANT 3Dmol API quirks here:
          //   • zoomTo({selection}) fits the camera AND sets the rotation
          //     pivot to the selection's centroid. Critical for keeping
          //     the ligand on-screen during mouse rotation.
          //   • zoom(factor) — factor < 1 zooms IN (camera closer),
          //     factor > 1 zooms OUT. (Earlier version had this wrong
          //     and used 1.4 thinking it zoomed in — that left the
          //     ligand tiny in a wide protein view.)
          // 0.6 is what JobPage's MutationOverlayViewer uses (it does
          // 0.55-0.7 depending on mode) — gives the ligand ~150% of the
          // canvas-fit while keeping enough binding-site cartoon for
          // context.
          const ligandIdx = posePdbqt || useEditedPreview ? 1 : -1;
          // (v0.51) Skip the auto-frame zoom when this rebuild was
          // triggered by a variant flip — savedView will be applied
          // below to restore the camera the user already had.
          if (!savedView) {
            if (ligandIdx >= 0) {
              viewer.zoomTo({ model: ligandIdx });
              viewer.zoom(0.6, 0);
            } else {
              viewer.zoomTo();
            }
          }
        } else {
          // (v0.30) Live (no-receptor) branch. Render the FRESHEST
          // conformer we have for the current SMILES — that's
          // editedConformerSdf when the user has edited since the dock,
          // otherwise plain conformerSdf. Without this preference, live
          // mode after a 2D edit would re-render the pre-edit geometry
          // because the fetch effect routes edited SMILES into
          // editedConformerSdf rather than overwriting conformerSdf.
          const liveSdf = (smilesEdited && editedConformerSdf) ? editedConformerSdf : conformerSdf;
          if (liveSdf) {
            viewer.addModel(liveSdf, "sdf");
            // (v0.51) Same camera-preserve rule applies in the live
            // conformer branch.
            if (!savedView) viewer.zoomTo();
          }
        }
        // (v0.51) Restore the user's prior camera state if this was a
        // pure variant flip — keeps the scene stable instead of
        // re-framing on every wt/both/mut click.
        if (savedView && typeof viewer.setView === "function") {
          try { viewer.setView(savedView); } catch { /* ignore */ }
        }
        applyStyles(viewer);
      } catch (e) {
        if (!cancelled) setConformerErr(`Render failed: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDockedScene, receptorPdb, posePdbqt, conformerSdf, editedConformerSdf, smilesEdited, viewVariant, receptorPdbAlt, altPosePdbqt]);

  // Re-apply styles when toolbar state OR the viewer instance changes.
  // viewerVersion bump ensures style re-applies after the data effect
  // creates a fresh viewer (otherwise the new viewer would render with
  // 3Dmol's defaults until the user clicks a toolbar button).
  useEffect(() => {
    if (viewerRef.current) applyStyles(viewerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backboneStyle, poseStyle, showContacts, mutation, viewerVersion]);

  // Wire / unwire the measure-mode click handler.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || typeof viewer.setClickable !== "function") return;
    if (!measureMode) {
      try { viewer.setClickable({}, false, null); } catch { /* */ }
      return;
    }
    const onClick = (atom: any) => {
      if (!atom) return;
      try {
        measurePicksRef.current.push({ x: atom.x, y: atom.y, z: atom.z });
        viewer.addSphere({ center: { x: atom.x, y: atom.y, z: atom.z }, radius: 0.35, color: "#f97316" });
        if (measurePicksRef.current.length === 2) {
          const [a, b] = measurePicksRef.current;
          const d = Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
          setMeasureDistance(d);
          viewer.addLine({ start: a, end: b, dashed: true, color: "#f97316" });
          const mid = { x: (a.x+b.x)/2, y: (a.y+b.y)/2, z: (a.z+b.z)/2 };
          viewer.addLabel(`${d.toFixed(2)} Å`, {
            position: mid, backgroundColor: "rgba(15,23,42,0.85)",
            backgroundOpacity: 0.85, fontColor: "white", fontSize: 12,
            borderThickness: 0, inFront: true,
          });
          measurePicksRef.current = [];
        }
        viewer.render();
      } catch { /* */ }
    };
    // 3Dmol's hit-test ray uses the canvas's screen bounding box to map
    // click pixels → 3D ray. Those bounds get stale if the user scrolled
    // or the panel resized between dock and toolbar-toggle. resize()
    // refreshes them, then render() rebuilds the hit-test geometry buffer
    // — without these calls the click handler fires but the picked atom
    // is wrong (or null), so the measurement silently does nothing.
    // Same pattern used by MutationOverlayViewer (the JobPage viewer).
    try {
      viewer.resize();
      viewer.setClickable({}, true, onClick);
      viewer.render();
    } catch { /* */ }
    return () => {
      // Pass an empty function rather than null — some 3Dmol versions
      // throw when null is passed as the callback.
      try { viewer.setClickable({}, false, () => {}); } catch { /* */ }
    };
    // viewerVersion in deps: when the viewer is rebuilt by the data
    // effect, this hook re-binds the click handler to the fresh
    // instance. Without it, measureMode would silently break after any
    // re-dock or 2D edit.
  }, [measureMode, viewerVersion]);

  // Fullscreen handling — Escape exits, and on toggle we tell 3Dmol to
  // resize so its WebGL viewport matches the new container size. Without
  // resize() the canvas would render at the original small size in the
  // top-left of a viewport-sized panel.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    // Defer one tick so the DOM has updated to the new layout before we
    // measure. Two RAFs is the standard idiom for "after style + layout".
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { v.resize(); v.render(); } catch { /* */ }
    }));
  }, [fullscreen]);

  // Camera helpers wired to toolbar buttons.
  const onResetView = () => {
    const v = viewerRef.current;
    if (!v) return;
    try {
      // Mirror the data-effect framing exactly so Reset returns to the
      // same view the user got after the dock. zoomTo({model: 1}) sets
      // both the camera AND the rotation pivot. zoom(0.6) zooms IN
      // (factor < 1 = closer in 3Dmol).
      if (hasDock && hasPose) {
        v.zoomTo({ model: 1 });
        v.zoom(0.6, 0);
      } else {
        v.zoomTo();
      }
      v.render();
    } catch { /* */ }
  };
  const onZoomIn = () => { try { viewerRef.current?.zoom(1.2, 200); } catch { /* */ } };
  const onZoomOut = () => { try { viewerRef.current?.zoom(0.8, 200); } catch { /* */ } };
  const onClearMeasure = () => {
    const v = viewerRef.current;
    if (!v) return;
    try {
      v.removeAllShapes();
      v.removeAllLabels();
      measurePicksRef.current = [];
      setMeasureDistance(null);
      applyStyles(v);
    } catch { /* */ }
  };

  const status = receptorErr || conformerErr;
  // v1.27 — `loading` ALWAYS wins so a fresh edit is visibly reflected
  // even when a stale editedConformerSdf is still on screen. Without
  // this the badge said "live preview" while a NEW conformer was being
  // fetched, making it look like the 3D wasn't tracking 2D edits.
  //
  // (v1.30 / U19) Pre-dock state now says "free conformer · run dock
  // for binding shape" instead of just "live conformer". Chemists were
  // comparing this preview to the docked-pose viewer on JobPage and
  // assuming they should look the same — but they're different states
  // (a free ligand vs the bound conformation that wraps into the
  // pocket). Loud badge + tooltip below make the distinction obvious.
  const statusBadge = hasDock
    ? loading
      ? <span className="text-cyan-300 animate-pulse">▮ updating 3D…</span>
      : smilesEdited
        ? editedConformerSdf
          ? <span className="text-amber-300" title="The SMILES has changed since the last dock — this is the free-state shape of the new structure, not the binding pose. Re-dock to score.">⚠ free conformer · re-dock to score</span>
          : <span className="text-cyan-300 animate-pulse">▮ updating preview…</span>
        : receptorPdb && posePdbqt
          ? <span className="text-sky-300" title="Quick Dock preview — a fast, SEPARATE docking run. Docking is stochastic on the GPU, so the saved Full Job pose is the authoritative one and will differ slightly from this preview. Same molecule, different run.">◐ quick-dock preview · {variant}</span>
          : <span className="text-cyan-300 animate-pulse">▮ loading receptor…</span>
    : loading
      ? <span className="text-cyan-300 animate-pulse">▮ updating 3D…</span>
      : conformerSdf
        ? <span className="text-amber-300" title="Free-state conformer from RDKit (UFF). NOT a binding pose — the actual bound shape will be different after docking, because the ligand folds to fit the pocket. Run Dock to compute the binding pose.">⚠ free conformer · run Dock for binding shape</span>
        : smiles
          ? <span className="text-slate-600">○ waiting</span>
          : <span className="text-slate-700">▢ empty</span>;

  // Show toolbar when there's content to control. Pre-conformer + no-dock
  // we still show pose/style toggles so users can preview the conformer
  // in different modes.
  const showToolbar = hasDock || !!conformerSdf;
  // v1.25 — collapse the 3D pane when there's literally nothing to
  // show. The 280px min-height was wasting half the right column on
  // every fresh visit and forcing users to scroll the Telemetry pane
  // to reach the Compound picker. When empty we shrink to a thin
  // banner; once any content lands (live conformer, dock result, dock
  // in progress) we snap back to the normal 40% layout.
  const is3DEmpty = !smiles && !dockResult && !dockResultWt && !status;

  return (
    <div className={
      fullscreen
        ? "fixed inset-0 z-50 bg-[#0d1422] border border-slate-800/70 flex flex-col overflow-hidden"
        : is3DEmpty
        ? "bg-[#0d1422] border border-slate-800/70 rounded flex flex-col overflow-hidden flex-shrink-0"
        : "bg-[#0d1422] border border-slate-800/70 rounded flex flex-col overflow-hidden h-[40%] min-h-[280px]"
    }>
      <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center justify-between text-[10px]">
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">3D View{fullscreen ? " · fullscreen (esc)" : ""}</span>
        <span className="font-mono text-slate-500">{statusBadge}</span>
      </div>

      {/* (U19) Inline explainer when the viewer is showing a FREE
          conformer (pre-dock). Chemists were comparing this preview to
          the docked-pose viewer on JobPage and assuming the difference
          in shape was a bug. It's not — a free ligand is extended in
          solvent; a bound ligand folds to fit the pocket. Make the
          distinction loud so nobody acts on the wrong picture. Hidden
          once a dock completes (the docked-pose badge above takes
          over). */}
      {!hasDock && !!conformerSdf && (
        <div className="px-3 py-1.5 border-b border-slate-800/70 bg-amber-950/30 text-[10px] text-amber-200/90 leading-relaxed">
          <span className="font-semibold">Free-state conformer.</span>{" "}
          This is RDKit&apos;s default 3D shape of the molecule in
          vacuum — <em>not</em> a binding pose. The actual bound
          conformation will fold differently to fit the pocket. Click{" "}
          <span className="font-mono text-amber-100">Run Dock</span>{" "}
          to compute it.
        </div>
      )}

      {/* (U28) Docked-preview explainer. Once a Quick Dock lands, this
          IS a bound pose — but it's a fast, SEPARATE docking run from
          the saved Full Job. Docking is stochastic on the GPU (parallel
          Monte-Carlo, not bit-reproducible even at a fixed seed), so the
          preview pose here and the saved job's pose are the same molecule
          from two different runs and will look slightly different. Say so
          plainly so the difference reads as expected, not a bug. Only
          shown for the clean docked-preview state (not while editing,
          not pre-dock). */}
      {hasDock && !smilesEdited && !loading && receptorPdb && posePdbqt && (
        <div className="px-3 py-1.5 border-b border-slate-800/70 bg-sky-950/30 text-[10px] text-sky-200/90 leading-relaxed">
          <span className="font-semibold">Quick Dock preview.</span>{" "}
          A fast, separate docking run. The saved Full Job pose is the
          authoritative one — because GPU docking is stochastic, it will
          differ slightly from this preview (same molecule, different run).
        </div>
      )}

      {showToolbar && (
        <div className="px-2 py-1.5 border-b border-slate-800/70 flex items-center gap-2 flex-wrap text-[9px] font-mono">
          {/* (v0.29) Live ↔ Dock toggle. Only meaningful once a dock has
              landed: before that, the live conformer is the only thing
              the viewer can show. After the dock, the user can flip
              back to the unbound conformer to compare geometries — and
              flip forward again to revisit the bound pose. The toggle
              auto-resets to "dock" each time a fresh dockResult lands. */}
          {hasDock && !!smiles && (
            <ViewerControlGroup label="VIEW MODE">
              <ViewerSegBtn active={viewMode === "live"} onClick={() => setViewMode("live")} title="Show the live (unbound) conformer of the current SMILES — RDKit ETKDG geometry, no receptor.">
                live
              </ViewerSegBtn>
              <ViewerSegBtn active={viewMode === "dock"} onClick={() => setViewMode("dock")} title="Show the docked pose with receptor (default after a dock completes).">
                docked
              </ViewerSegBtn>
            </ViewerControlGroup>
          )}
          {/* (v0.43) Variant toggle — visible only when BOTH a WT and
              a mutant result are loaded. Lets the user flip the 3D
              scene between the two receptor + pose pairs. The pose-
              contact highlights and the camera framing follow whichever
              variant is active. */}
          {!!dockResult && !!dockResultWt && (
            <ViewerControlGroup label="VARIANT">
              <ViewerSegBtn
                active={viewVariant === "wt"}
                onClick={() => setViewVariant("wt")}
                title="Show the wild-type receptor and the WT-docked pose."
              >
                wt
              </ViewerSegBtn>
              <ViewerSegBtn
                active={viewVariant === "both"}
                onClick={() => setViewVariant("both")}
                title="Overlay BOTH variants: primary receptor + pose at full opacity, the other variant's receptor (slate, 45% opacity) and pose (flat color, 85% opacity) on top so you can compare side-chain shifts and pose differences in one frame."
              >
                both
              </ViewerSegBtn>
              <ViewerSegBtn
                active={viewVariant === "mut"}
                onClick={() => setViewVariant("mut")}
                title={`Show the mutant receptor (${mutation || "mut"}) and its docked pose.`}
                tone="amber"
              >
                {mutation ? mutation.toLowerCase() : "mut"}
              </ViewerSegBtn>
            </ViewerControlGroup>
          )}
          {hasDock && (
            <ViewerControlGroup label="BACKBONE">
              <ViewerSegBtn active={backboneStyle === "cartoon"} onClick={() => setBackboneStyle("cartoon")} title="Cartoon ribbon">cartoon</ViewerSegBtn>
              <ViewerSegBtn active={backboneStyle === "surface"} onClick={() => setBackboneStyle("surface")} title="Translucent solvent surface — best to see the pocket shape">surface</ViewerSegBtn>
              <ViewerSegBtn active={backboneStyle === "line"} onClick={() => setBackboneStyle("line")} title="Bond line wireframe">line</ViewerSegBtn>
              <ViewerSegBtn active={backboneStyle === "hide"} onClick={() => setBackboneStyle("hide")} title="Hide receptor — pose only">hide</ViewerSegBtn>
            </ViewerControlGroup>
          )}
          <ViewerControlGroup label="POSE">
            <ViewerSegBtn active={poseStyle === "stick"} onClick={() => setPoseStyle("stick")} title="Sticks (default)">stick</ViewerSegBtn>
            <ViewerSegBtn active={poseStyle === "ball"} onClick={() => setPoseStyle("ball")} title="Ball-and-stick">ball</ViewerSegBtn>
            <ViewerSegBtn active={poseStyle === "line"} onClick={() => setPoseStyle("line")} title="Wireframe">line</ViewerSegBtn>
            <ViewerSegBtn active={poseStyle === "sphere"} onClick={() => setPoseStyle("sphere")} title="Space-filling spheres">sphere</ViewerSegBtn>
          </ViewerControlGroup>
          {hasDock && contactResnums.length > 0 && (
            <ViewerControlGroup label="CONTACTS">
              <ViewerSegBtn active={showContacts} onClick={() => setShowContacts(!showContacts)} title="Toggle binding-pocket side chains">
                {showContacts ? "on" : "off"}
              </ViewerSegBtn>
            </ViewerControlGroup>
          )}
          <div className="flex-1" />
          <ViewerControlGroup label="VIEW">
            <ViewerSegBtn active={false} onClick={onZoomOut} title="Zoom out">−</ViewerSegBtn>
            <ViewerSegBtn active={false} onClick={onZoomIn} title="Zoom in">+</ViewerSegBtn>
            <ViewerSegBtn active={false} onClick={onResetView} title="Reset camera to default framing">reset</ViewerSegBtn>
            <ViewerSegBtn active={fullscreen} onClick={() => setFullscreen(f => !f)} title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen — fill the entire viewport"}>
              {fullscreen ? "⊠ exit" : "⛶ full"}
            </ViewerSegBtn>
          </ViewerControlGroup>
          <ViewerControlGroup label="MEASURE">
            <ViewerSegBtn
              active={measureMode}
              onClick={() => setMeasureMode(!measureMode)}
              title="Click two atoms to measure distance (Å)"
              tone="amber"
            >
              {measureMode ? "click 2 atoms" : "off"}
            </ViewerSegBtn>
            {measureDistance !== null && (
              <span className="px-1.5 text-amber-300 tabular-nums">{measureDistance.toFixed(2)} Å</span>
            )}
            {(measureMode || measureDistance !== null) && (
              <ViewerSegBtn active={false} onClick={onClearMeasure} title="Clear measurement marks">clear</ViewerSegBtn>
            )}
          </ViewerControlGroup>
        </div>
      )}

      <div className={is3DEmpty ? "relative bg-[#0f172a] overflow-hidden" : "flex-1 relative bg-[#0f172a] overflow-hidden"}>
        {/* Keep the 3D canvas mounted but invisible when empty so the
            3Dmol viewer instance isn't recreated each time a user
            picks a compound (re-init costs ~200ms). */}
        <div ref={containerRef} className={is3DEmpty ? "hidden" : "absolute inset-0"} />
        {/* Onboarding empty state — shows when there's no compound and
            no docking result yet. Walks the user through the 5-step
            flow so a first-time visitor knows what to do, but stays
            compact so the bulk of the right column belongs to the
            target / mutation / compound pickers in Telemetry. The
            expandable details lets curious users see the full
            walkthrough without forcing it on everyone. */}
        {is3DEmpty && (
          <details className="group px-3 py-2.5 text-xs font-mono leading-relaxed text-slate-300">
            <summary className="flex items-center gap-2 cursor-pointer list-none select-none">
              <span className="text-cyan-400 text-[10px] tracking-[0.2em] uppercase">▸ studio · ready</span>
              <span className="flex-1 h-px bg-gradient-to-r from-cyan-500/40 to-transparent" />
              <span className="text-[9px] uppercase tracking-wider text-slate-500 group-open:hidden">▾ 5-step guide</span>
              <span className="text-[9px] uppercase tracking-wider text-slate-500 hidden group-open:inline">▴ hide guide</span>
            </summary>
            <div className="mt-2">
              <div className="mb-2 text-slate-400 text-[11px]">Mutation-aware docking in 5 steps:</div>
              <ol className="space-y-1 text-[11px]">
                <li className="flex gap-2"><span className="text-cyan-400 tabular-nums">1.</span><span><span className="text-slate-200">Pick a target</span> <span className="text-slate-500">— curated catalog, RCSB PDB search, or upload</span></span></li>
                <li className="flex gap-2"><span className="text-cyan-400 tabular-nums">2.</span><span><span className="text-slate-200">Choose mutation(s)</span> <span className="text-slate-500">— curated chips or type any code (T790M, V600E…)</span></span></li>
                <li className="flex gap-2"><span className="text-cyan-400 tabular-nums">3.</span><span><span className="text-slate-200">Choose compound(s)</span> <span className="text-slate-500">— sketch, paste a SMILES list, or upload (up to 50)</span></span></li>
                <li className="flex gap-2"><span className="text-cyan-400 tabular-nums">4.</span><span><span className="text-slate-200">Run Dock</span> <span className="text-slate-500">— scores WT + each mutant in parallel</span></span></li>
                <li className="flex gap-2"><span className="text-cyan-400 tabular-nums">5.</span><span><span className="text-slate-200">Inspect &amp; iterate</span> <span className="text-slate-500">— Δ-vs-WT, Kd, 3D pose, AI variants</span></span></li>
              </ol>
            </div>
          </details>
        )}
        {status && (
          <div className="absolute bottom-2 left-2 right-2 px-2 py-1 rounded bg-rose-950/60 border border-rose-900/60 text-[10px] text-rose-200 font-mono">
            ✗ {status}
          </div>
        )}
      </div>
    </div>
  );
}

/** Tiny label + segmented-button group used by the 3D viewer toolbar.
 *  Designed to match the rest of Studio's control-center vibe: monospace,
 *  uppercase tiny labels, faint border, cyan accent for the active item. */
function ViewerControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] tracking-[0.18em] text-slate-600 mr-0.5 select-none">{label}</span>
      <div className="flex items-center bg-[#070b15] rounded border border-slate-800 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/** A single segmented-button cell. Active uses cyan; the amber tone is
 *  reserved for action modes (measure). */
function ViewerSegBtn({
  active, onClick, title, children, tone = "cyan",
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  tone?: "cyan" | "amber";
}) {
  const accent = tone === "amber"
    ? "border-amber-500/60 bg-amber-900/40 text-amber-200"
    : "border-cyan-500/60 bg-cyan-900/40 text-cyan-200";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider border-r border-slate-800 last:border-r-0 transition-colors ${
        active ? accent : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
      }`}
    >
      {children}
    </button>
  );
}

// LiveConformerPlaceholder removed in v0.16.2 — ProductionViewer3D now
// handles both pre-dock conformer preview and post-dock receptor+pose
// in one self-contained component, using the same 3Dmol pattern that
// was already proven to render correctly here.
