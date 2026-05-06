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
  pose_offset_a?: number;
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
  // Typeahead query strings — filter the chip rows live as the user
  // types. Empty string = show all chips (default).
  const [targetQuery, setTargetQuery] = useState("");
  const [mutationQuery, setMutationQuery] = useState("");

  const [docking, setDocking] = useState(false);
  const [dockError, setDockError] = useState<string | null>(null);
  const [dockResult, setDockResult] = useState<QuickDockResult | null>(null);

  const [now, setNow] = useState(new Date());
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

  const [showProps, setShowProps] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  // Dropdown open/closed state for target & mutation pickers. Closed
  // by default — current selection shows as a chip with a chevron;
  // clicking expands to show full filtered list. The search input on
  // the right stays visible always (typing into it auto-opens the
  // dropdown so users don't have to click twice).
  const [targetDropdownOpen, setTargetDropdownOpen] = useState(false);
  const [mutationDropdownOpen, setMutationDropdownOpen] = useState(false);
  // 2D editor theme — Ketcher's bundled build doesn't honor ?theme=dark,
  // so we fake dark mode with the "dark reader" CSS filter trick:
  // invert(1) hue-rotate(180deg) flips the background to black while
  // re-rotating hues so red atoms still look red. This works on any
  // 2D molecular editor (or any web content) without needing the iframe
  // to cooperate. Imperfect on raster images and gradients but Ketcher
  // is line art so the result is clean. 2026-05-05 user fallback.
  const [editorTheme, setEditorTheme] = useState<"light" | "dark">("light");
  const [iframeKey] = useState(0);  // reserved for future remounts
  const darkFilter = "invert(0.92) hue-rotate(180deg) brightness(1.1) contrast(0.95)";

  const { data: catalog } = useQuery({
    queryKey: ["catalog"],
    queryFn: api.catalog,
  });
  const { data: myCompounds } = useQuery({
    queryKey: ["my-compounds"],
    queryFn: api.getMyCompounds,
    staleTime: 60_000,
  });

  /** Load a SMILES into the Ketcher canvas. Used by the compound picker
   *  to start from a known structure (drug or saved library entry). */
  async function loadIntoCanvas(smiles: string) {
    if (!smiles) return;
    const a = getKetcherApi(iframeRef.current);
    if (!a?.setMolecule) {
      setDockError("Editor not ready yet — wait a moment and try again.");
      return;
    }
    try {
      await a.setMolecule(smiles);
      setShowLoader(false);
      // Trigger an immediate poll-style update so currentSmiles refreshes
      setTimeout(async () => {
        try {
          const s = await a.getSmiles();
          setCurrentSmiles((s || "").trim());
        } catch { /* polling will catch it */ }
      }, 100);
    } catch (e: any) {
      setDockError(`Failed to load structure: ${e?.message || e}`);
    }
  }

  // When target or mutation changes, the previous dock result is no
  // longer valid — clear it so the 3D viewer drops back to live-conformer
  // mode and the score/hits/misses don't lie. Without this, switching
  // from EGFR to KRAS leaves the EGFR ribbon + EGFR pose on screen with
  // a stale -6.50 score even though the panel now says KRAS · Q61H.
  // 2026-05-05 user-reported bug.
  useEffect(() => {
    setDockResult(null);
    setDockError(null);
    // The Live3DViewer's internal centroid/smiles refs reset naturally
    // when its dockResult prop transitions to null (the post-dock-preview
    // effect short-circuits because isPostDockPreview becomes false).
  }, [selectedTarget, selectedMutation]);

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
        <section className="col-span-7 bg-[#0d1422] border border-slate-800/70 rounded flex flex-col overflow-hidden relative">
          <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center justify-between text-[10px]">
            <span className={TOK.label}>2D Canvas · Ketcher</span>
            <div className="flex items-center gap-2">
              {/* 2D theme toggle — bumps iframe key so Ketcher reloads
                  with ?theme=dark or default. Current SMILES is preserved
                  by re-applying it after the iframe re-inits. */}
              <button
                onClick={() => setEditorTheme(editorTheme === "light" ? "dark" : "light")}
                className="px-2 py-0.5 rounded border font-mono text-[10px] uppercase tracking-wider transition-colors border-slate-700/60 text-slate-400 hover:text-cyan-300 hover:border-cyan-700/50"
                title={`Switch 2D editor to ${editorTheme === "light" ? "dark" : "light"} mode`}
              >
                {editorTheme === "light" ? "☼ light" : "☾ dark"}
              </button>
              <span className="font-mono text-slate-500">{currentSmiles ? `${currentSmiles.length} chars` : "—"}</span>
            </div>
          </div>
          {showLoader && (
            <CompoundLoader
              targetMeta={targetMeta}
              myCompounds={myCompounds || []}
              onPick={loadIntoCanvas}
              onClose={() => setShowLoader(false)}
            />
          )}
          <div className="flex-1 relative bg-white">
            {!ketcherReady && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs font-mono z-10 bg-[#070b15]">
                <span className="animate-pulse">▮ initializing editor</span>
              </div>
            )}
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={KETCHER_SRC}
              title="Ketcher 2D editor"
              className="w-full h-full border-0"
              style={editorTheme === "dark" ? { filter: darkFilter } : undefined}
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
            mutation={selectedMutation || null}
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
                  {dockResult ? (
                    <>
                      {dockResult.pose_offset_a != null && (
                        <span title="Distance from docked pose centroid to the pocket box center. Threshold: 6 Å. Higher numbers = pose drifted toward edge of search box.">
                          {dockResult.pose_offset_a.toFixed(1)} Å ·{" "}
                        </span>
                      )}
                      {(dockResult.hits?.length || 0)} hits · {(dockResult.misses?.length || 0)} miss
                    </>
                  ) : "pocket box"}
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

            {/* ─── COMPOUND ─── */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex items-center justify-between mb-2">
                <span className={TOK.label}>Compound</span>
                <button
                  onClick={() => setShowLoader(!showLoader)}
                  className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded border border-cyan-700/40 text-cyan-300 hover:bg-cyan-950/40"
                  title="Load reference, library, or paste SMILES"
                >
                  ▸ load
                </button>
              </div>
              <div className="font-mono text-[11px] text-slate-300 truncate" title={currentSmiles || "(empty)"}>
                {currentSmiles || <span className="text-slate-600 italic">— sketch or load a structure —</span>}
              </div>
            </div>

            {/* ─── TARGET (dropdown + search on right) ─── */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex items-center justify-between mb-2">
                <span className={TOK.label}>Target</span>
                <span className="font-mono text-[9px] text-slate-600">
                  {(() => {
                    const all = catalog?.length || 0;
                    const filt = catalog?.filter((t: any) =>
                      !targetQuery || t.id.toLowerCase().includes(targetQuery.toLowerCase()) ||
                      (t.name || "").toLowerCase().includes(targetQuery.toLowerCase())
                    ).length || 0;
                    return targetQuery ? `${filt}/${all}` : `${all} available`;
                  })()}
                </span>
              </div>
              {/* Trigger row: dropdown showing current selection (LEFT) +
                  search input (RIGHT). Click trigger or type to expand
                  the option list below. */}
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setTargetDropdownOpen(!targetDropdownOpen)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-cyan-500/60 bg-cyan-900/30 text-cyan-200 font-mono text-[11px] uppercase tracking-wider hover:bg-cyan-900/50 min-w-[80px]"
                  title={targetMeta?.name || ""}
                >
                  <span className={`text-[8px] transition-transform ${targetDropdownOpen ? "rotate-90" : ""}`}>▸</span>
                  <span>{targetMeta?.id?.toUpperCase() || "—"}</span>
                </button>
                <input
                  type="text"
                  value={targetQuery}
                  onChange={(e) => { setTargetQuery(e.target.value); if (e.target.value) setTargetDropdownOpen(true); }}
                  onFocus={() => setTargetDropdownOpen(true)}
                  placeholder="search…"
                  className="flex-1 px-2 py-1 text-[10px] font-mono rounded border border-slate-700/60 text-slate-200 placeholder:text-slate-600 bg-[#070b15] focus:outline-none focus:border-cyan-500/60"
                />
              </div>
              {/* Expanded chip list — visible when dropdown is open OR
                  when there's a search query (forces visibility so the
                  user sees what their typing matches). */}
              {(targetDropdownOpen || targetQuery) && (
                <div className="flex flex-wrap items-center gap-1.5 max-h-32 overflow-auto pt-1 border-t border-slate-800/70">
                  {catalog
                    ?.filter((t: any) =>
                      !targetQuery ||
                      t.id.toLowerCase().includes(targetQuery.toLowerCase()) ||
                      (t.name || "").toLowerCase().includes(targetQuery.toLowerCase())
                    )
                    .map((t: any) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setSelectedTarget(t.id);
                          setSelectedMutation("");
                          setTargetQuery("");
                          setTargetDropdownOpen(false);
                        }}
                        className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded border transition-colors ${
                          selectedTarget === t.id
                            ? "border-cyan-500/60 bg-cyan-900/30 text-cyan-200"
                            : "border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600"
                        }`}
                        title={t.name}
                      >
                        {t.id}
                      </button>
                    ))}
                  {targetQuery && !catalog?.some((t: any) =>
                    t.id.toLowerCase().includes(targetQuery.toLowerCase()) ||
                    (t.name || "").toLowerCase().includes(targetQuery.toLowerCase())
                  ) && (
                    <span className="text-[10px] font-mono text-amber-400/80 italic">no match</span>
                  )}
                </div>
              )}
            </div>

            {/* ─── MUTATIONS (dropdown + search on right) ─── */}
            <div className="px-4 py-3 border-b border-slate-800/70">
              <div className="flex items-center justify-between mb-2">
                <span className={TOK.label}>Mutations</span>
                <span className="font-mono text-[9px] text-slate-600">
                  {(() => {
                    const all = availableMutations.length;
                    const filt = availableMutations.filter(m =>
                      !mutationQuery ||
                      m.code.toLowerCase().includes(mutationQuery.toLowerCase()) ||
                      (m.label || "").toLowerCase().includes(mutationQuery.toLowerCase())
                    ).length;
                    return mutationQuery ? `${filt}/${all}` : `${all} curated`;
                  })()}
                </span>
              </div>
              {/* Trigger row: current mutation chip on the LEFT (or "WT" if
                  none selected), search input on the RIGHT. Pressing Enter
                  on a non-matching query commits it as a custom mutation. */}
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setMutationDropdownOpen(!mutationDropdownOpen)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded border font-mono text-[11px] uppercase tracking-wider min-w-[80px] ${
                    selectedMutation
                      ? "border-amber-500/60 bg-amber-900/30 text-amber-200 hover:bg-amber-900/50"
                      : "border-slate-600 bg-slate-700/40 text-slate-200 hover:bg-slate-700/60"
                  }`}
                  title={selectedMutation || "Wild-type — click for mutations"}
                >
                  <span className={`text-[8px] transition-transform ${mutationDropdownOpen ? "rotate-90" : ""}`}>▸</span>
                  <span>{selectedMutation || "WT"}</span>
                </button>
                <input
                  type="text"
                  value={mutationQuery}
                  onChange={(e) => { setMutationQuery(e.target.value.toUpperCase()); if (e.target.value) setMutationDropdownOpen(true); }}
                  onFocus={() => setMutationDropdownOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && mutationQuery.trim()) {
                      setSelectedMutation(mutationQuery.trim());
                      setMutationQuery("");
                      setMutationDropdownOpen(false);
                    }
                  }}
                  placeholder="search · ⏎ for custom"
                  className="flex-1 px-2 py-1 text-[10px] font-mono rounded border border-slate-700/60 text-slate-200 placeholder:text-slate-600 bg-[#070b15] focus:outline-none focus:border-amber-500/60"
                />
              </div>
              {(mutationDropdownOpen || mutationQuery) && (
                <div className="flex flex-wrap items-center gap-1.5 max-h-32 overflow-auto pt-1 border-t border-slate-800/70">
                  <button
                    onClick={() => { setSelectedMutation(""); setMutationDropdownOpen(false); }}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded border ${
                      selectedMutation === ""
                        ? "border-slate-500 bg-slate-700/40 text-slate-200"
                        : "border-slate-700/60 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    WT
                  </button>
                  {availableMutations
                    .filter(m =>
                      !mutationQuery ||
                      m.code.toLowerCase().includes(mutationQuery.toLowerCase()) ||
                      (m.label || "").toLowerCase().includes(mutationQuery.toLowerCase())
                    )
                    .map((m) => (
                      <button
                        key={m.code}
                        onClick={() => {
                          setSelectedMutation(m.code);
                          setMutationQuery("");
                          setMutationDropdownOpen(false);
                        }}
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
                  {mutationQuery && availableMutations.filter(m =>
                    m.code.toLowerCase().includes(mutationQuery.toLowerCase()) ||
                    (m.label || "").toLowerCase().includes(mutationQuery.toLowerCase())
                  ).length === 0 && (
                    <span className="text-[10px] font-mono text-amber-400/80 italic">
                      no curated match — press Enter to use as custom
                    </span>
                  )}
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
                {docking ? "▶ docking…" : "⏵ Run Dock"}
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

/** Tiny labelled group of toggle buttons for the 3D toolbar. Renders
 *  a faint "RECEPTOR" / "LIGAND" / "TOOLS" caption above its children
 *  so the user can scan groupings instead of reading every button. */
function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] uppercase tracking-[0.2em] text-slate-600 mr-0.5">{label}</span>
      <div className="flex items-center bg-[#070b15] rounded border border-slate-800 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/** Compact pill button for the 3D toolbar. Active state uses cyan; the
 *  amber tone is reserved for "this changes how clicks work" modes
 *  (currently just measure mode). */
function ControlBtn({
  active = false, onClick, title, children, tone = "cyan",
}: {
  active?: boolean; onClick: () => void; title?: string; children: React.ReactNode; tone?: "cyan" | "amber";
}) {
  const accent = tone === "amber"
    ? "border-amber-500/60 bg-amber-900/40 text-amber-200"
    : "border-cyan-500/60 bg-cyan-900/40 text-cyan-200";
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-2 py-1 font-mono text-[9px] uppercase tracking-wider border-r border-slate-800 last:border-r-0 transition-colors ${
        active ? accent : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
      }`}
    >
      {children}
    </button>
  );
}

/** Compound loader panel — slides down below the canvas header when
 *  the user clicks "load compound". Three sources:
 *   1. Reference compounds for the currently-selected target (e.g. EGFR
 *      ships with gefitinib/erlotinib/osimertinib/afatinib). Most useful
 *      starting point — these are the ground-truth inhibitors the
 *      mutation set is calibrated against.
 *   2. The user's saved library (CompoundsPage entries).
 *   3. A free-form SMILES paste box for ad-hoc structures.
 *
 *  Selecting any entry calls Ketcher's setMolecule() and closes the
 *  panel. The 3D viewer picks up the change automatically via the
 *  SMILES polling tick. */
function CompoundLoader({
  targetMeta, myCompounds, onPick, onClose,
}: {
  targetMeta: any;
  myCompounds: any[];
  onPick: (smiles: string) => void;
  onClose: () => void;
}) {
  const [paste, setPaste] = useState("");
  const [search, setSearch] = useState("");
  // PubChem live autocomplete — debounced 250ms after typing settles.
  // Backed by /lookup/compound/suggest which proxies PubChem's
  // autocomplete endpoint. Returns up to 8 name suggestions.
  const [pubchemSuggestions, setPubchemSuggestions] = useState<string[]>([]);
  const [pubchemLoading, setPubchemLoading] = useState(false);
  const [pubchemErr, setPubchemErr] = useState<string | null>(null);
  // When a user clicks a PubChem name, we fire /lookup/compound to
  // resolve to SMILES. Loading state per-name so multiple clicks don't
  // race or flicker the global spinner.
  const [resolvingName, setResolvingName] = useState<string | null>(null);

  const refCompounds = (targetMeta?.compounds ?? []) as { name: string; smiles: string; mechanism?: string }[];
  const q = search.trim().toLowerCase();
  const filteredRef = q
    ? refCompounds.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.smiles.toLowerCase().includes(q) ||
        (c.mechanism || "").toLowerCase().includes(q))
    : refCompounds;
  const filteredLib = q
    ? myCompounds.filter(c =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.smiles || "").toLowerCase().includes(q))
    : myCompounds;

  // PubChem autocomplete — debounced 250ms. Skip when query is shorter
  // than 2 chars (too noisy) or matches an existing reference/library
  // name exactly (we already have it locally).
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed.length < 2) {
      setPubchemSuggestions([]);
      setPubchemErr(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setPubchemLoading(true);
      setPubchemErr(null);
      try {
        const res = await api.suggestCompound(trimmed);
        if (cancelled) return;
        setPubchemSuggestions(res.suggestions || []);
      } catch (e: any) {
        if (!cancelled) setPubchemErr(e?.message || "PubChem lookup failed");
      } finally {
        if (!cancelled) setPubchemLoading(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [search]);

  async function loadFromPubChem(name: string) {
    setResolvingName(name);
    setPubchemErr(null);
    try {
      const res = await api.lookupCompound(name);
      if (res?.smiles) {
        onPick(res.smiles);
      } else {
        setPubchemErr(`PubChem returned no SMILES for "${name}"`);
      }
    } catch (e: any) {
      setPubchemErr(e?.message || `Couldn't resolve "${name}"`);
    } finally {
      setResolvingName(null);
    }
  }

  return (
    <div className="absolute top-[34px] left-0 right-0 z-20 bg-[#0d1422] border-b border-slate-800/70 max-h-[70%] overflow-auto">
      {/* Search bar — filters both reference + library lists */}
      <div className="px-3 py-2 border-b border-slate-800/70 flex items-center gap-2">
        <span className="text-cyan-400 text-xs">🔍</span>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter by name, SMILES, or mechanism…"
          className="flex-1 bg-transparent border-none outline-none font-mono text-xs text-slate-200 placeholder:text-slate-600"
        />
        {search && (
          <button onClick={() => setSearch("")} className="text-slate-500 hover:text-slate-200 font-mono text-[10px]">clear</button>
        )}
      </div>
      {/* PubChem live suggestions — populated as the user types.
          Click any pill to resolve via /lookup/compound and load the
          SMILES into Ketcher. This is the same data source NewJobPage's
          name-lookup uses, so anything you can type in /new also works
          here (drugs, metabolites, IUPAC names). */}
      {search.trim().length >= 2 && (pubchemLoading || pubchemSuggestions.length > 0 || pubchemErr) && (
        <div className="px-3 py-2 border-b border-slate-800/70 bg-[#070b15]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] uppercase tracking-[0.18em] text-cyan-500">PubChem</span>
            {pubchemLoading && <span className="text-[10px] font-mono text-slate-500 animate-pulse">▮ searching…</span>}
            {!pubchemLoading && pubchemSuggestions.length > 0 && (
              <span className="text-[10px] font-mono text-slate-600">{pubchemSuggestions.length} matches</span>
            )}
            {!pubchemLoading && !pubchemErr && pubchemSuggestions.length === 0 && search.trim().length >= 2 && (
              <span className="text-[10px] font-mono text-slate-600 italic">no match</span>
            )}
            {pubchemErr && (
              <span className="text-[10px] font-mono text-rose-400">{pubchemErr}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pubchemSuggestions.map((name) => (
              <button
                key={name}
                onClick={() => loadFromPubChem(name)}
                disabled={resolvingName !== null}
                className={`px-2 py-1 font-mono text-[11px] rounded border transition-colors ${
                  resolvingName === name
                    ? "border-cyan-500/60 bg-cyan-900/40 text-cyan-200 animate-pulse"
                    : "border-cyan-700/40 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 hover:border-cyan-500/60 disabled:opacity-50 disabled:cursor-wait"
                }`}
                title={`Resolve "${name}" via PubChem and load the SMILES into Ketcher`}
              >
                {resolvingName === name ? `▮ ${name}` : name}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Empty-state hint — only when literally nothing matched anywhere */}
      {q && filteredRef.length === 0 && filteredLib.length === 0 && pubchemSuggestions.length === 0 && !pubchemLoading && (
        <div className="px-3 py-2 bg-amber-950/20 border-b border-amber-900/40 text-[11px] font-mono text-amber-200">
          ⚠ no match for &ldquo;<span className="text-amber-100">{search}</span>&rdquo; in reference compounds, your library, or PubChem.
          {" "}Use the <span className="text-amber-100">Paste SMILES</span> column on the right to load by structure instead.
        </div>
      )}
      <div className="grid grid-cols-3 divide-x divide-slate-800/70">
        {/* Reference compounds for current target */}
        <div className="p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2 flex items-center gap-2">
            <span>Reference · {targetMeta?.id?.toUpperCase() || "—"}</span>
            <span className="text-slate-700">{filteredRef.length}{q && refCompounds.length !== filteredRef.length ? `/${refCompounds.length}` : ""}</span>
          </div>
          <div className="space-y-1">
            {filteredRef.length > 0 ? filteredRef.map((c) => (
              <button
                key={c.name}
                onClick={() => onPick(c.smiles)}
                className="w-full text-left px-2 py-1.5 rounded border border-slate-800 hover:border-cyan-700/50 hover:bg-cyan-950/20 transition-colors group"
              >
                <div className="font-mono text-xs text-slate-200 group-hover:text-cyan-200">{c.name}</div>
                {c.mechanism && (
                  <div className="font-mono text-[10px] text-slate-500 truncate" title={c.mechanism}>
                    {c.mechanism}
                  </div>
                )}
              </button>
            )) : (
              <div className="font-mono text-[11px] text-slate-600 italic">{q ? "no match" : "Pick a target first"}</div>
            )}
          </div>
        </div>

        {/* User's saved library */}
        <div className="p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2 flex items-center gap-2">
            <span>My Library</span>
            <span className="text-slate-700">{filteredLib.length}{q && myCompounds.length !== filteredLib.length ? `/${myCompounds.length}` : ""}</span>
          </div>
          <div className="space-y-1">
            {filteredLib.length > 0 ? filteredLib.slice(0, 30).map((c) => (
              <button
                key={c.id}
                onClick={() => onPick(c.smiles)}
                className="w-full text-left px-2 py-1.5 rounded border border-slate-800 hover:border-cyan-700/50 hover:bg-cyan-950/20 transition-colors group"
              >
                <div className="font-mono text-xs text-slate-200 group-hover:text-cyan-200 truncate">{c.name}</div>
                <div className="font-mono text-[10px] text-slate-500 truncate" title={c.smiles}>
                  {c.smiles}
                </div>
              </button>
            )) : (
              <div className="font-mono text-[11px] text-slate-600 italic">{q ? "no match" : "No saved compounds yet"}</div>
            )}
            {filteredLib.length > 30 && (
              <div className="font-mono text-[10px] text-slate-600 italic px-2">
                +{filteredLib.length - 30} more — refine search above
              </div>
            )}
          </div>
        </div>

        {/* Paste SMILES */}
        <div className="p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-2">Paste SMILES</div>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O"
            className="w-full h-20 p-2 bg-[#070b15] border border-slate-800 rounded font-mono text-[11px] text-slate-200 resize-none focus:outline-none focus:border-cyan-600/60"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => paste.trim() && onPick(paste.trim())}
              disabled={!paste.trim()}
              className="px-3 py-1 rounded border border-cyan-600/60 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/40 disabled:border-slate-800 disabled:bg-slate-900/30 disabled:text-slate-600 disabled:cursor-not-allowed font-mono text-[10px] uppercase tracking-wider transition-colors"
            >
              ⏵ Load
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1 rounded border border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-600 font-mono text-[10px] uppercase tracking-wider transition-colors"
            >
              cancel
            </button>
          </div>
          <div className="mt-2 text-[10px] font-mono text-slate-600">
            Examples: <button onClick={() => onPick("CC(=O)Oc1ccccc1C(=O)O")} className="text-cyan-500 hover:text-cyan-300 underline">aspirin</button>
            {" · "}
            <button onClick={() => onPick("CC(C)Cc1ccc(C(C)C(=O)O)cc1")} className="text-cyan-500 hover:text-cyan-300 underline">ibuprofen</button>
            {" · "}
            <button onClick={() => onPick("CN1CCC[C@H]1c1cccnc1")} className="text-cyan-500 hover:text-cyan-300 underline">nicotine</button>
          </div>
        </div>
      </div>
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
  smiles, dockResult, mutation,
}: {
  smiles: string;
  dockResult: QuickDockResult | null;
  /** Mutation tag (e.g. "T790M") if user selected one. When non-null and
   *  a dock has run, the viewer fetches BOTH the WT receptor AND the
   *  mutant receptor and shows a 3-zone slider in the toolbar that lets
   *  the chemist morph between them: WT only / both overlaid / mutant
   *  only. Dock pose is bound to the docked variant; the slider only
   *  switches receptor visibility. */
  mutation: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const lastRenderedSmilesRef = useRef<string>("");
  const lastDockResultIdRef = useRef<string>("");
  const dockedSmilesRef = useRef<string>("");
  const dockedCentroidRef = useRef<[number, number, number] | null>(null);
  const measureRef = useRef<{ atoms: any[] }>({ atoms: [] });
  // In docked mode we keep model indices stable so the slider can
  // toggle visibility without re-loading. With a mutation:
  //   model 0 = WT receptor, model 1 = mutant receptor, model 2 = ligand pose
  // Without a mutation (WT-only dock):
  //   model 0 = WT receptor, model 1 = ligand pose
  const hasMutationOverlayRef = useRef<boolean>(false);
  const [conformerSdf, setConformerSdf] = useState<string | null>(null);
  const [conformerErr, setConformerErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [glReady, setGlReady] = useState(false);
  // Controls — apply to whichever model is currently shown
  const [ligandStyle, setLigandStyle] = useState<"stick" | "ball" | "sphere" | "line">("stick");
  const [receptorStyle, setReceptorStyle] = useState<"cartoon" | "surface" | "line" | "hide">("cartoon");
  const [measureMode, setMeasureMode] = useState(false);
  // Slider for WT/mutant morph (0-100). 3-zone:
  //   0-33  → WT only (model 0 visible, model 1 hidden)
  //   33-66 → both visible (geometric overlap)
  //   66-100→ mutant only (model 0 hidden, model 1 visible)
  const [wtMutantBlend, setWtMutantBlend] = useState(50);

  // Re-apply styles whenever the toggles change. Idempotent — setStyle
  // replaces the existing style spec, so it's safe to call repeatedly.
  function applyStyles() {
    const v = viewerRef.current;
    if (!v) return;
    try {
      if (dockResult) {
        const hasOverlay = hasMutationOverlayRef.current;
        const wtIdx = 0;
        const mutIdx = hasOverlay ? 1 : -1;
        const ligandIdx = hasOverlay ? 2 : 1;
        // 3-zone slider visibility (only meaningful when overlay is mounted)
        const showWt = !hasOverlay || wtMutantBlend < 67;
        const showMut = hasOverlay && wtMutantBlend > 33;
        const wtColor = "#64748b";    // slate-500
        const mutColor = "#22d3ee";   // cyan-400 — visually distinct from WT
        // Clear receptor styles
        v.setStyle({ model: wtIdx }, {});
        if (mutIdx >= 0) v.setStyle({ model: mutIdx }, {});
        try { v.removeAllSurfaces(); } catch { /* */ }
        if (showWt) {
          if (receptorStyle === "cartoon") v.setStyle({ model: wtIdx }, { cartoon: { color: wtColor } });
          else if (receptorStyle === "surface") {
            v.setStyle({ model: wtIdx }, { cartoon: { color: wtColor } });
            try { v.addSurface(2, { opacity: 0.5, color: "#334155" }, { model: wtIdx }); } catch { /* */ }
          }
          else if (receptorStyle === "line") v.setStyle({ model: wtIdx }, { line: { color: wtColor } });
        }
        if (showMut && mutIdx >= 0) {
          if (receptorStyle === "cartoon") v.setStyle({ model: mutIdx }, { cartoon: { color: mutColor } });
          else if (receptorStyle === "surface") {
            v.setStyle({ model: mutIdx }, { cartoon: { color: mutColor } });
            try { v.addSurface(2, { opacity: 0.45, color: "#0e7490" }, { model: mutIdx }); } catch { /* */ }
          }
          else if (receptorStyle === "line") v.setStyle({ model: mutIdx }, { line: { color: mutColor } });
        }
        v.setStyle({ model: ligandIdx }, ligandStyleSpec(ligandStyle));
      } else {
        v.setStyle({}, ligandStyleSpec(ligandStyle));
      }
      v.render();
    } catch { /* defensive — 3Dmol API quirks */ }
  }

  function ligandStyleSpec(s: typeof ligandStyle) {
    // Stick radius bumped 0.18 → 0.28 for visibility against a large
    // protein ribbon. The default in DockedPoseViewer is 0.18 but
    // that viewer is a small 280×280 panel with a tight pocket-box
    // zoom; in Studio's full-width viewer the radius needs to be
    // bigger to read clearly. 2026-05-05 user feedback: "after dock
    // there's just a hexagon with ribbons" — the molecule was rendering
    // correctly but at the wrong visual weight for the camera distance.
    if (s === "stick") return { stick: { radius: 0.28, colorscheme: "cyanCarbon" } };
    if (s === "ball") return { sphere: { scale: 0.32, colorscheme: "cyanCarbon" }, stick: { radius: 0.18, colorscheme: "cyanCarbon" } };
    if (s === "sphere") return { sphere: { scale: 0.95, colorscheme: "cyanCarbon" } };
    return { line: { colorscheme: "cyanCarbon", linewidth: 3 } };
  }

  function resetView() {
    const v = viewerRef.current;
    if (!v) return;
    try {
      // In docked mode, fit the pocket (ligand + 8Å of receptor) — the
      // useful view. In conformer mode, fit the whole molecule.
      if (dockResult) {
        const ligandIdx = hasMutationOverlayRef.current ? 2 : 1;
        try {
          v.zoomTo({ within: { distance: 8, sel: { model: ligandIdx } } });
        } catch {
          v.zoomTo({ model: ligandIdx });
        }
      } else {
        v.zoomTo();
      }
      v.render();
    } catch { /* defensive */ }
  }

  function clearMeasurements() {
    const v = viewerRef.current;
    if (!v) return;
    try {
      v.removeAllShapes();
      v.removeAllLabels();
      measureRef.current.atoms = [];
      v.render();
    } catch { /* defensive */ }
  }

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
      v.removeAllShapes();
      v.removeAllLabels();
      v.addModel(conformerSdf, "sdf");
      // Only zoomTo on first model — preserve camera on updates
      if (!v._didFirstZoom) {
        v.zoomTo();
        v._didFirstZoom = true;
      }
      applyStyles();
    } catch (e) {
      setConformerErr(`Render failed: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glReady, conformerSdf, dockResult]);

  // Re-apply styles whenever toggles or the WT/mutant slider change
  useEffect(() => {
    applyStyles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ligandStyle, receptorStyle, wtMutantBlend]);

  // POST-DOCK PREVIEW MODE: receptor stays mounted, ligand is swapped
  // for a fresh conformer translated to the docked-pose centroid as
  // the user edits the 2D canvas. Renders in amber to signal "preview,
  // not docked — click Run Dock to re-run." Useful for "what would
  // adding a methyl here look like in the pocket?" without burning a
  // full dock cycle.
  const isPostDockPreview = !!dockResult
    && !!smiles
    && smiles !== dockedSmilesRef.current
    && !!dockedCentroidRef.current;

  useEffect(() => {
    if (!isPostDockPreview || !glReady || !viewerRef.current) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      if (cancelled || smiles === lastRenderedSmilesRef.current) return;
      try {
        const res = await api.assistConformer(smiles);
        if (!res.ok || !res.sdf) return;
        if (cancelled) return;
        const v = viewerRef.current;
        // Remove only the ligand model (preserves receptor(s) so the
        // amber preview molecule appears in the same pocket frame).
        const ligandIdx = hasMutationOverlayRef.current ? 2 : 1;
        try { v.removeModel(ligandIdx); } catch { /* */ }
        const m = v.addModel(res.sdf, "sdf");
        // Translate the new conformer so its centroid matches the
        // docked-pose centroid (where the original ligand was sitting
        // in the pocket). RDKit emits conformers near the origin, so
        // we just translate by the docked centroid.
        try {
          const atoms = m?.selectedAtoms?.({}) || [];
          let cx = 0, cy = 0, cz = 0;
          for (const a of atoms) { cx += a.x; cy += a.y; cz += a.z; }
          if (atoms.length > 0) {
            cx /= atoms.length; cy /= atoms.length; cz /= atoms.length;
          }
          const [tx, ty, tz] = dockedCentroidRef.current!;
          const dx = tx - cx, dy = ty - cy, dz = tz - cz;
          for (const a of atoms) { a.x += dx; a.y += dy; a.z += dz; }
        } catch { /* defensive */ }
        // Style: amber sticks so it reads as "preview, not docked"
        v.setStyle({ model: ligandIdx }, { stick: { radius: 0.28, color: "#fbbf24" } });
        // Same tight pocket framing as the docked-pose path
        try {
          v.zoomTo({ within: { distance: 8, sel: { model: ligandIdx } } });
        } catch {
          try { v.zoomTo({ model: ligandIdx }); } catch { /* */ }
        }
        v.render();
        lastRenderedSmilesRef.current = smiles;
      } catch { /* defensive */ }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [smiles, isPostDockPreview, glReady]);

  // Toggle measure-mode atom-click handler on the viewer
  useEffect(() => {
    const v = viewerRef.current;
    if (!glReady || !v) return;
    if (measureMode) {
      v.setClickable({}, true, (atom: any) => {
        const picked = measureRef.current.atoms;
        picked.push(atom);
        try {
          v.addSphere({ center: { x: atom.x, y: atom.y, z: atom.z }, radius: 0.4, color: "cyan", opacity: 0.7 });
          if (picked.length === 2) {
            const a = picked[0], b = picked[1];
            const d = Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
            v.addLine({ start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z }, color: "cyan", dashed: true });
            v.addLabel(`${d.toFixed(2)} Å`, {
              position: { x: (a.x+b.x)/2, y: (a.y+b.y)/2, z: (a.z+b.z)/2 },
              backgroundColor: "rgba(8, 145, 178, 0.85)", fontColor: "white", fontSize: 12, borderThickness: 0,
            });
            measureRef.current.atoms = [];
          }
          v.render();
        } catch { /* defensive */ }
      });
    } else {
      try { v.setClickable({}, false, () => {}); } catch { /* */ }
    }
  }, [glReady, measureMode]);

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
        v.removeAllShapes();
        v.removeAllLabels();
        try { v.removeAllSurfaces(); } catch { /* */ }
        // model 0: WT receptor
        const wtRes = await fetch(
          `https://api.liganx.com/structures/${dockResult.pdb_id}/${dockResult.chain || "A"}/WT`
        );
        if (wtRes.ok) {
          const recPdb = await wtRes.text();
          v.addModel(recPdb, "pdb");
        }
        // model 1: mutant receptor (only if mutation selected and not "WT")
        const wantsOverlay = !!mutation && mutation.toUpperCase() !== "WT";
        if (wantsOverlay) {
          try {
            const mutRes = await fetch(
              `https://api.liganx.com/structures/${dockResult.pdb_id}/${dockResult.chain || "A"}/${mutation}`
            );
            if (mutRes.ok) {
              const mutPdb = await mutRes.text();
              v.addModel(mutPdb, "pdb");
              hasMutationOverlayRef.current = true;
            } else {
              hasMutationOverlayRef.current = false;
            }
          } catch {
            hasMutationOverlayRef.current = false;
          }
        } else {
          hasMutationOverlayRef.current = false;
        }
        // Last model: ligand pose
        const poseModel = v.addModel(atob(poseB64), "pdbqt");
        // Compute centroid of the docked ligand atoms — saved so a
        // post-dock conformer preview can be translated to the same
        // spot in the receptor pocket.
        try {
          const atoms = poseModel?.selectedAtoms?.({}) || [];
          if (atoms.length > 0) {
            let sx = 0, sy = 0, sz = 0;
            for (const a of atoms) { sx += a.x; sy += a.y; sz += a.z; }
            dockedCentroidRef.current = [sx / atoms.length, sy / atoms.length, sz / atoms.length];
          }
        } catch { /* defensive */ }
        // Remember the SMILES that was actually docked, so we know when
        // the user has edited it and we should switch to preview mode.
        dockedSmilesRef.current = smiles;
        // Apply current style toggles
        applyStyles();
        const ligandIdxForZoom = hasMutationOverlayRef.current ? 2 : 1;
        // Frame the ligand + pocket residues only, not the whole protein.
        // Without this, the ligand reads as a tiny hexagon against the
        // full receptor ribbon. 2026-05-05 user feedback. The "within"
        // selector pulls ligand atoms + every receptor atom within 8Å,
        // and zoomTo frames that subset to the viewport. Result: ligand
        // fills a meaningful portion of the panel and the surrounding
        // pocket residues are visible as context.
        try {
          v.zoomTo({ within: { distance: 8, sel: { model: ligandIdxForZoom } } });
        } catch {
          // Older 3Dmol versions don't support `within` — fall back to
          // ligand-only fit which still beats whole-protein zoom.
          try { v.zoomTo({ model: ligandIdxForZoom }); } catch { /* */ }
        }
        v.render();
      } catch (e) {
        setConformerErr(`Pose render failed: ${(e as Error).message}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glReady, dockResult]);

  return (
    <div className="bg-[#0d1422] border border-slate-800/70 rounded flex flex-col overflow-hidden h-[40%] min-h-0">
      {/* Title strip — title + status only, no controls */}
      <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center justify-between text-[10px]">
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">3D View</span>
        <span className="font-mono text-slate-500">
          {isPostDockPreview ? <span className="text-amber-300">◌ preview · re-dock to confirm</span>
            : dockResult ? <span className="text-cyan-300">▦ docked · {dockResult.pdb_id}</span>
            : loading ? <span className="text-cyan-300 animate-pulse">▮ generating…</span>
            : conformerSdf ? <span className="text-emerald-400">● live conformer</span>
            : smiles ? <span className="text-slate-600">○ waiting</span>
            : <span className="text-slate-700">▢ empty</span>}
        </span>
      </div>
      {/* Control toolbar — own row, grouped, breathing room */}
      <div className="px-3 py-1.5 border-b border-slate-800/70 flex items-center gap-3 text-[10px] flex-wrap">
        {dockResult && (
          <ControlGroup label="Receptor">
            {(["cartoon", "surface", "line", "hide"] as const).map((s) => (
              <ControlBtn key={s} active={receptorStyle === s} onClick={() => setReceptorStyle(s)} title={`Receptor: ${s}`}>
                {s === "cartoon" ? "ribbon" : s}
              </ControlBtn>
            ))}
          </ControlGroup>
        )}
        <ControlGroup label="Ligand">
          {(["stick", "ball", "sphere", "line"] as const).map((s) => (
            <ControlBtn key={s} active={ligandStyle === s} onClick={() => setLigandStyle(s)} title={`Ligand: ${s}`}>
              {s}
            </ControlBtn>
          ))}
        </ControlGroup>
        <ControlGroup label="Tools">
          <ControlBtn
            active={measureMode}
            tone={measureMode ? "amber" : undefined}
            onClick={() => setMeasureMode(!measureMode)}
            title="Click two atoms to measure distance"
          >
            ⟷ measure
          </ControlBtn>
          {measureMode && (
            <ControlBtn onClick={clearMeasurements} title="Clear measurements">clear</ControlBtn>
          )}
          <ControlBtn onClick={resetView} title="Reset camera">↺ fit</ControlBtn>
        </ControlGroup>
      </div>

      {/* WT ↔ MUTANT slider — only shown when a mutant overlay was loaded.
          3-zone semantics:
            0-33   → WT only (model 0 visible, model 1 hidden)
            33-66  → both visible (geometric overlap — see what shifted)
            66-100 → mutant only
          The label below the slider tells the user what zone they're in. */}
      {dockResult && hasMutationOverlayRef.current && mutation && (
        <div className="px-3 py-2 border-b border-slate-800/70 bg-[#070b15]">
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <span className="text-slate-500 uppercase tracking-[0.18em] text-[9px]">Receptor</span>
            <span className={`${wtMutantBlend < 67 ? "text-slate-300" : "text-slate-600"}`}>WT</span>
            <input
              type="range"
              min={0}
              max={100}
              value={wtMutantBlend}
              onChange={(e) => setWtMutantBlend(Number(e.target.value))}
              className="flex-1 accent-cyan-400 h-1"
              title={
                wtMutantBlend < 33 ? "WT only" :
                wtMutantBlend > 66 ? `${mutation} only` : `WT + ${mutation} (overlay)`
              }
            />
            <span className={`${wtMutantBlend > 33 ? "text-cyan-300" : "text-slate-600"}`}>{mutation}</span>
            <span className="text-slate-500 ml-1 min-w-[80px] text-right">
              {wtMutantBlend < 33 ? "WT only" :
               wtMutantBlend > 66 ? `${mutation} only` :
               "overlay"}
            </span>
          </div>
        </div>
      )}
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
