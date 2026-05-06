/**
 * Studio (v0.1) — unified workspace, control-center aesthetic.
 *
 * Design principles, drawn from spacecraft mission control / Bloomberg
 * terminal / SpaceX MCC:
 *
 *  1. Critical telemetry is always visible. The score, pose status, and
 *     pod connectivity sit in fixed positions and never collapse. The
 *     operator never has to "find" them.
 *  2. Secondary tools are collapsible. Properties, AI variants, history
 *     hide behind chevrons but are one click away. Closed by default
 *     so the canvas + KPI panel get the visual real estate.
 *  3. Numbers are monospace. Digits don't jump as values update — the
 *     score reads "−7.20" cleanly even when it's transitioning.
 *  4. Status by shape, not by text. ●○✓✗▶▾ communicate state at a
 *     glance. Color reinforces (cyan = active, amber = caution, rose
 *     = failure, emerald = pass) but is never the only signal.
 *  5. Dark by default. The chemist will stare at this for hours.
 *  6. Minimal chrome. Borders are 1px slate-800. No drop shadows. No
 *     gradients. Information density first; ornament never.
 *
 * Lives at /studio. Existing pages are untouched and remain canonical.
 * If users prefer this, it gets promoted; if not, deleted with no
 * downstream impact.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

const KETCHER_SRC = "/ketcher/index.html";

interface QuickDockResult {
  ok: boolean;
  score?: number;
  hits?: string[];
  misses?: string[];
  pose_pdbqt_b64?: string;
  pdb_id?: string;
  chain?: string;
  error?: string;
  receptor_variant?: "mutant" | "wt";
  mutation_caveat?: string;
  pose_in_pocket?: boolean;
  dock_attempts?: number;
}

function getKetcherApi(iframe: HTMLIFrameElement | null): any | null {
  if (!iframe) return null;
  try {
    return (iframe.contentWindow as any)?.ketcher ?? null;
  } catch {
    return null;
  }
}

function fmtScore(s: number | undefined | null): string {
  if (s == null) return "—.——";
  return s >= 0 ? `+${s.toFixed(2)}` : s.toFixed(2);
}

function fmtClock(d: Date): string {
  return d.toISOString().slice(11, 19) + " UTC";
}

export default function StudioPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ketcherReady, setKetcherReady] = useState(false);
  const [currentSmiles, setCurrentSmiles] = useState("");

  const [selectedTarget, setSelectedTarget] = useState<string>("egfr");
  const [selectedMutation, setSelectedMutation] = useState<string>("");

  const [docking, setDocking] = useState(false);
  const [dockError, setDockError] = useState<string | null>(null);
  const [dockResult, setDockResult] = useState<QuickDockResult | null>(null);

  const [now, setNow] = useState(new Date());
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

  const [showProps, setShowProps] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data: catalog } = useQuery({
    queryKey: ["catalog"],
    queryFn: api.catalog,
  });

  // Tick clock every second; probe pod health every 30s
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const r = await fetch("https://api.liganx.com/health/full");
        const j = await r.json();
        if (!cancelled) setHealthOk(j?.pod_dock_status === "ok");
      } catch {
        if (!cancelled) setHealthOk(false);
      }
    };
    probe();
    const t = window.setInterval(probe, 30_000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, []);

  // Ketcher init detection
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e?.data?.eventType === "init") setKetcherReady(true);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // SMILES polling
  useEffect(() => {
    if (!ketcherReady) return;
    let cancelled = false;
    const t = window.setInterval(async () => {
      const a = getKetcherApi(iframeRef.current);
      if (!a?.getSmiles) return;
      try {
        const s: string = await a.getSmiles();
        if (cancelled) return;
        setCurrentSmiles((s || "").trim());
      } catch {
        /* polling errors non-fatal */
      }
    }, 700);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [ketcherReady]);

  const targetMeta = useMemo(
    () => catalog?.find((t: any) => t.id === selectedTarget),
    [catalog, selectedTarget]
  );
  const availableMutations = (targetMeta?.mutations ?? []) as { code: string; label: string }[];

  async function runQuickDock() {
    if (!currentSmiles) { setDockError("Canvas is empty — sketch a structure first."); return; }
    if (!selectedTarget) { setDockError("Pick a target."); return; }
    setDocking(true);
    setDockError(null);
    setDockResult(null);
    try {
      const res = await api.assistQuickDock({
        smiles: currentSmiles,
        target_pdb: selectedTarget,
        chain: targetMeta?.chain || "A",
        mutation: selectedMutation || undefined,
      });
      if (!res.ok) setDockError(res.error || "Dock failed.");
      else setDockResult(res as QuickDockResult);
    } catch (e: any) {
      setDockError(e?.message || "Dock failed.");
    } finally {
      setDocking(false);
    }
  }

  // Centralised tokens — change here, propagates everywhere
  const TOK = {
    label: "text-[10px] uppercase tracking-[0.18em] text-slate-500",
    valueLg: "font-mono text-3xl tabular-nums",
    cyan: "text-cyan-300",
    amber: "text-amber-300",
    rose: "text-rose-300",
    emerald: "text-emerald-300",
    dim: "text-slate-500",
  };

  const statusDot = (ok: boolean | null) => {
    if (ok === true) return <span className="text-emerald-400">●</span>;
    if (ok === false) return <span className="text-rose-400">●</span>;
    return <span className="text-slate-600">○</span>;
  };

  return (
    <div className="min-h-screen bg-[#070b15] text-slate-200 select-none">
      {/* ═══ STATUS BAR ═══ */}
      <header className="sticky top-0 z-30 bg-[#0d1422] border-b border-slate-800/70 px-4 py-2">
        <div className="flex items-center gap-6 text-[11px] tracking-wide">
          <div className="flex items-center gap-2">
            <span className="text-cyan-400 text-base leading-none">⦿</span>
            <span className="font-semibold tracking-[0.18em] uppercase">Studio</span>
            <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-900/40 text-cyan-300 border border-cyan-800/50">v0.1·BETA</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={TOK.label}>Target</span>
            <span className="font-mono uppercase tracking-wider">
              {targetMeta?.id?.toUpperCase() || "—"}
              {selectedMutation && <span className="text-cyan-300"> · {selectedMutation}</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">{statusDot(ketcherReady)} <span className={TOK.label}>Editor</span></div>
          <div className="flex items-center gap-2">{statusDot(healthOk)} <span className={TOK.label}>Pod</span></div>
          <div className="ml-auto flex items-center gap-4">
            <span className={TOK.label}>SMILES</span>
            <span className="font-mono text-[10px] text-slate-400 max-w-[40ch] truncate" title={currentSmiles}>
              {currentSmiles || <span className="italic text-slate-600">empty</span>}
            </span>
            <span className="font-mono text-[10px] text-slate-500">{fmtClock(now)}</span>
          </div>
        </div>
      </header>

      {/* ═══ MAIN GRID ═══ */}
      <main className="grid grid-cols-12 gap-3 p-3" style={{ height: "calc(100vh - 88px)" }}>
        {/* LEFT — 2D Canvas */}
        <section className="col-span-7 bg-[#0d1422] border border-slate-800/70 rounded flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center justify-between text-[10px]">
            <span className={TOK.label}>2D Canvas · Ketcher</span>
            <span className="font-mono text-slate-500">{currentSmiles ? `${currentSmiles.length} chars` : "—"}</span>
          </div>
          <div className="flex-1 relative bg-white">
            {!ketcherReady && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs font-mono z-10 bg-[#070b15]">
                <span className="animate-pulse">▮ initializing editor</span>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={KETCHER_SRC}
              title="Ketcher 2D editor"
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </section>

        {/* RIGHT — 3D + KPI */}
        <section className="col-span-5 flex flex-col gap-3 min-h-0">
          {/* 3D viewer — live conformer until dock result, then docked pose */}
          <Live3DViewer
            smiles={currentSmiles}
            dockResult={dockResult}
          />

          {/* KPI panel */}
          <div className="bg-[#0d1422] border border-slate-800/70 rounded flex flex-col flex-1 min-h-0">
            <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center justify-between text-[10px]">
              <span className={TOK.label}>Telemetry</span>
              <span className="font-mono text-slate-500">
                {docking ? <span className="text-cyan-300 animate-pulse">▶ docking…</span>
                  : dockResult ? `attempt ${dockResult.dock_attempts || 1}`
                  : "ready"}
              </span>
            </div>

            {/* Score + Pose row — biggest type on the page */}
            <div className="px-4 pt-3 pb-2 grid grid-cols-2 gap-2 border-b border-slate-800/70">
              <div>
                <div className={TOK.label}>Score</div>
                <div className={`${TOK.valueLg} ${dockResult?.score != null ? TOK.cyan : TOK.dim}`}>
                  {fmtScore(dockResult?.score)}
                </div>
                <div className="text-[10px] font-mono text-slate-500">kcal/mol · exh=8</div>
              </div>
              <div>
                <div className={TOK.label}>Pose</div>
                <div className={`${TOK.valueLg} ${
                  dockResult?.pose_in_pocket === true ? TOK.emerald
                  : dockResult?.pose_in_pocket === false ? TOK.amber
                  : TOK.dim
                }`}>
                  {dockResult?.pose_in_pocket === true ? "✓ in"
                    : dockResult?.pose_in_pocket === false ? "◌ out"
                    : "—"}
                </div>
                <div className="text-[10px] font-mono text-slate-500">
                  {dockResult ? `${(dockResult.hits?.length || 0)} hits · ${(dockResult.misses?.length || 0)} miss` : "pocket box"}
                </div>
              </div>
            </div>

            {/* Hits / Misses */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex gap-6 text-[11px] font-mono">
                <div className="flex-1 min-w-0">
                  <div className={`${TOK.label} mb-1`}>Hits</div>
                  <div className="text-emerald-300 truncate" title={(dockResult?.hits || []).join(" · ")}>
                    {dockResult?.hits?.length
                      ? dockResult.hits.slice(0, 5).join(" · ") + (dockResult.hits.length > 5 ? ` +${dockResult.hits.length - 5}` : "")
                      : <span className="text-slate-600">—</span>}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`${TOK.label} mb-1`}>Misses</div>
                  <div className="text-rose-300 truncate" title={(dockResult?.misses || []).join(" · ")}>
                    {dockResult?.misses?.length
                      ? dockResult.misses.slice(0, 5).join(" · ") + (dockResult.misses.length > 5 ? ` +${dockResult.misses.length - 5}` : "")
                      : <span className="text-slate-600">—</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Target / mutation chips */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className={`${TOK.label} mb-2`}>Target / Mutation</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {catalog?.map((t: any) => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTarget(t.id); setSelectedMutation(""); }}
                    className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded border transition-colors ${
                      selectedTarget === t.id
                        ? "border-cyan-500/60 bg-cyan-900/30 text-cyan-200"
                        : "border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600"
                    }`}
                  >
                    {t.id}
                  </button>
                ))}
              </div>
              {availableMutations.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => setSelectedMutation("")}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded border ${
                      selectedMutation === ""
                        ? "border-slate-500 bg-slate-700/40 text-slate-200"
                        : "border-slate-700/60 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    WT
                  </button>
                  {availableMutations.map((m) => (
                    <button
                      key={m.code}
                      onClick={() => setSelectedMutation(m.code)}
                      className={`px-2 py-0.5 text-[10px] font-mono rounded border ${
                        selectedMutation === m.code
                          ? "border-amber-500/60 bg-amber-900/30 text-amber-200"
                          : "border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600"
                      }`}
                      title={m.label}
                    >
                      {m.code}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Action area */}
            <div className="px-4 py-3 mt-auto">
              {dockError && (
                <div className="mb-2 px-2 py-1.5 rounded bg-rose-950/40 border border-rose-900/60 text-[11px] text-rose-200 font-mono">
                  ✗ {dockError}
                </div>
              )}
              {dockResult?.mutation_caveat && (
                <div className="mb-2 px-2 py-1.5 rounded bg-amber-950/40 border border-amber-900/60 text-[10px] text-amber-200 font-mono">
                  ⚠ {dockResult.mutation_caveat}
                </div>
              )}
              <button
                onClick={runQuickDock}
                disabled={docking || !ketcherReady || !currentSmiles || !selectedTarget}
                className={`w-full px-4 py-2.5 rounded border font-mono text-xs uppercase tracking-[0.18em] transition-all ${
                  docking
                    ? "border-cyan-500/50 bg-cyan-950/40 text-cyan-300 cursor-wait animate-pulse"
                    : !ketcherReady || !currentSmiles
                    ? "border-slate-800 bg-slate-900/30 text-slate-600 cursor-not-allowed"
                    : "border-cyan-600/60 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500"
                }`}
              >
                {docking ? "▶ docking…" : "⏵ Run Quick Dock"}
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* ═══ COLLAPSIBLE BOTTOM STRIP ═══ */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0d1422] border-t border-slate-800/70 flex text-[10px] z-20">
        <CollapsibleTab label="Properties" open={showProps} onToggle={() => setShowProps(!showProps)}>
          <PropertiesPanel smiles={currentSmiles} />
        </CollapsibleTab>
        <CollapsibleTab label="AI Variants" open={showAi} onToggle={() => setShowAi(!showAi)}>
          <div className="text-slate-500 font-mono text-[11px] p-3">AI variant generation · v0.2 (deferred)</div>
        </CollapsibleTab>
        <CollapsibleTab label="History" open={showHistory} onToggle={() => setShowHistory(!showHistory)}>
          <div className="text-slate-500 font-mono text-[11px] p-3">Session dock history · v0.2 (deferred)</div>
        </CollapsibleTab>
      </div>
    </div>
  );
}

/** Collapsible bottom-strip tab. Closed = just a ▸ Label header.
 *  Open = expands upward as a 240px-tall panel above the strip. */
function CollapsibleTab({
  label, open, onToggle, children,
}: {
  label: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="flex-1 border-r border-slate-800/70 last:border-r-0 relative">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-800/30 transition-colors"
      >
        <span className={`text-cyan-400 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        <span className="uppercase tracking-[0.18em] text-slate-400 font-mono">{label}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 h-60 bg-[#0d1422] border-t border-l border-r border-slate-800/70 overflow-auto">
          {children}
        </div>
      )}
    </div>
  );
}

/** Live 3D viewer — the headline feature.
 *
 *  As the user sketches in 2D, the 3D viewer updates within ~500ms. Pipeline:
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
function Live3DViewer({
  smiles, dockResult,
}: {
  smiles: string;
  dockResult: QuickDockResult | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const lastRenderedSmilesRef = useRef<string>("");
  const lastDockResultIdRef = useRef<string>("");
  const [conformerSdf, setConformerSdf] = useState<string | null>(null);
  const [conformerErr, setConformerErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [glReady, setGlReady] = useState(false);

  // Mount the 3Dmol viewer ONCE. Lazy import keeps initial bundle small.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod: any = await import("3dmol");
        const $3Dmol: any = mod?.default ?? mod?.$3Dmol ?? mod;
        if (cancelled || !containerRef.current) return;
        const viewer = $3Dmol.createViewer(containerRef.current, {
          backgroundColor: 0x070b15,
          antialias: true,
        });
        viewerRef.current = viewer;
        setGlReady(true);
      } catch (e) {
        if (!cancelled) setConformerErr(`3Dmol load failed: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      try { viewerRef.current?.clear?.(); } catch { /* defensive */ }
      viewerRef.current = null;
    };
  }, []);

  // Debounced SMILES → conformer fetch
  useEffect(() => {
    if (!smiles || dockResult) {
      // Either canvas is empty, or we have a docked pose to show instead
      return;
    }
    const t = window.setTimeout(async () => {
      // Dedupe — don't refetch the same SMILES we just rendered
      if (smiles === lastRenderedSmilesRef.current) return;
      setLoading(true);
      setConformerErr(null);
      try {
        const res = await api.assistConformer(smiles);
        if (res.ok && res.sdf) {
          setConformerSdf(res.sdf);
          lastRenderedSmilesRef.current = smiles;
        } else {
          setConformerErr(res.error || "Conformer failed");
        }
      } catch (e: any) {
        setConformerErr(e?.message || "Conformer request failed");
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [smiles, dockResult]);

  // Render conformer SDF when it arrives (and no dock result yet)
  useEffect(() => {
    if (!glReady || !viewerRef.current || !conformerSdf || dockResult) return;
    try {
      const v = viewerRef.current;
      v.removeAllModels();
      v.addModel(conformerSdf, "sdf");
      v.setStyle({}, { stick: { radius: 0.15, colorscheme: "Jmol" } });
      // Only zoomTo on first model — preserve camera on updates
      if (lastRenderedSmilesRef.current === smiles && !lastDockResultIdRef.current) {
        if (!v._didFirstZoom) {
          v.zoomTo();
          v._didFirstZoom = true;
        }
      }
      v.render();
    } catch (e) {
      setConformerErr(`Render failed: ${(e as Error).message}`);
    }
  }, [glReady, conformerSdf, dockResult, smiles]);

  // Render docked pose when dockResult arrives
  useEffect(() => {
    if (!glReady || !viewerRef.current || !dockResult?.pose_pdbqt_b64) return;
    const poseB64 = dockResult.pose_pdbqt_b64 || "";
    const dockKey = `${dockResult.pdb_id}-${dockResult.score}-${poseB64.slice(0, 20)}`;
    if (lastDockResultIdRef.current === dockKey) return;
    lastDockResultIdRef.current = dockKey;
    (async () => {
      try {
        const v = viewerRef.current;
        v.removeAllModels();
        // Receptor — fetch from API
        const recRes = await fetch(
          `https://api.liganx.com/structures/${dockResult.pdb_id}/${dockResult.chain || "A"}/WT`
        );
        if (recRes.ok) {
          const recPdb = await recRes.text();
          v.addModel(recPdb, "pdb");
          v.setStyle({}, { cartoon: { color: "#475569" } });
        }
        // Ligand pose — decode base64 PDBQT
        const poseText = atob(poseB64);
        v.addModel(poseText, "pdbqt");
        v.setStyle({ model: -1 }, { stick: { radius: 0.18, colorscheme: "cyanCarbon" } });
        v.zoomTo({ model: -1 });
        v.zoom(0.85);
        v.render();
      } catch (e) {
        setConformerErr(`Pose render failed: ${(e as Error).message}`);
      }
    })();
  }, [glReady, dockResult]);

  return (
    <div className="bg-[#0d1422] border border-slate-800/70 rounded flex flex-col overflow-hidden h-[40%] min-h-0">
      <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center justify-between text-[10px]">
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">3D View</span>
        <span className="font-mono text-slate-500">
          {dockResult ? <span className="text-cyan-300">▦ docked · {dockResult.pdb_id}</span>
            : loading ? <span className="text-cyan-300 animate-pulse">▮ generating…</span>
            : conformerSdf ? <span className="text-emerald-400">● live conformer</span>
            : smiles ? <span className="text-slate-600">○ waiting</span>
            : <span className="text-slate-700">▢ empty</span>}
        </span>
      </div>
      <div className="flex-1 relative bg-[#070b15]">
        <div ref={containerRef} className="absolute inset-0" />
        {!glReady && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-600 font-mono text-[11px] pointer-events-none animate-pulse">
            ▮ loading 3D engine
          </div>
        )}
        {glReady && !smiles && !dockResult && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-700 font-mono text-[11px] pointer-events-none">
            ▢ sketch a structure
          </div>
        )}
        {conformerErr && (
          <div className="absolute bottom-2 left-2 right-2 px-2 py-1 rounded bg-rose-950/60 border border-rose-900/60 text-[10px] text-rose-200 font-mono">
            ✗ {conformerErr}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact properties readout — fetched only when smiles present + panel open. */
function PropertiesPanel({ smiles }: { smiles: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["assist-properties", smiles],
    queryFn: () => api.assistProperties(smiles),
    enabled: !!smiles,
    staleTime: 60_000,
  });
  if (!smiles) return <div className="text-slate-600 font-mono text-[11px] p-3">▢ canvas empty</div>;
  if (isLoading || !data) return <div className="text-slate-500 font-mono text-[11px] p-3 animate-pulse">▮ computing…</div>;
  const p: any = data;
  const Stat = ({ label, value, ok }: { label: string; value: any; ok?: boolean }) => (
    <div className="px-3 py-2 border-r border-slate-800/50 last:border-r-0">
      <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`font-mono text-sm tabular-nums ${
        ok === true ? "text-emerald-300" : ok === false ? "text-rose-300" : "text-slate-200"
      }`}>{value ?? "—"}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-7 text-[11px]">
      <Stat label="MW" value={p.mw?.toFixed(1)} />
      <Stat label="logP" value={p.logp?.toFixed(2)} />
      <Stat label="QED" value={p.qed?.toFixed(2)} />
      <Stat label="TPSA" value={p.tpsa?.toFixed(1)} />
      <Stat label="HBD/HBA" value={`${p.hbd ?? "—"}/${p.hba ?? "—"}`} />
      <Stat label="Ro5" value={p.lipinski_pass ? "pass" : "fail"} ok={!!p.lipinski_pass} />
      <Stat label="SA" value={p.sa_score?.toFixed(1)} ok={p.sa_score ? p.sa_score < 6 : undefined} />
    </div>
  );
}
