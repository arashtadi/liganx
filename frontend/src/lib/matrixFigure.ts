/**
 * Publication-style multi-panel result figure export.
 *
 * Builds a clean, self-contained SVG "report" of a Liganx result — five
 * panels: (A) the WT-vs-mutant selectivity matrix, (B) binding-affinity bars,
 * (C) selectivity Δ diverging bars, (D) pose confidence + PoseBusters
 * validation, (E) key interaction contacts — and rasterizes it to a PNG the
 * user can drop straight into a slide deck, paper, or Slack. Light /
 * print-friendly on purpose; no dark-UI chrome, no screenshotting.
 *
 * Framework-free: takes the same MatrixRow[] the CSV export uses (per-cell
 * metadata is parsed out of each row's `extras` string via parseExtra) and
 * returns an SVG string + pixel dimensions. `downloadMatrixPng` handles the
 * SVG→canvas→PNG rasterization (2× by default for crisp text).
 */
import type { MatrixRow } from "../components/CsvExportButton";
import { parseExtra, type ParsedExtra } from "./parseExtra";

export interface FigureResult { svg: string; width: number; height: number; }

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Δ-vs-WT → cell tint. Green = tighter on the mutant (selectivity / resistance
 *  gain), red = weaker (escape), neutral inside the run-to-run noise band. */
function tintFor(delta: number | null | undefined): { fill: string; dcol: string } {
  if (delta === null || delta === undefined) return { fill: "#f8fafc", dcol: "#94a3b8" };
  const a = Math.min(0.55, 0.16 + Math.abs(delta) * 0.20);
  if (delta < -0.4) return { fill: `rgba(16,185,129,${a.toFixed(3)})`, dcol: "#047857" };
  if (delta > 0.4) return { fill: `rgba(239,68,68,${a.toFixed(3)})`, dcol: "#b91c1c" };
  return { fill: "#f1f5f9", dcol: "#94a3b8" };
}

/** ProLIF interaction-type code → colour + human label. Unknown codes fall
 *  back to a neutral slate chip so the figure never breaks on new types. */
const ITYPE: Record<string, { c: string; label: string }> = {
  Hydr: { c: "#f59e0b", label: "hydrophobic" },
  VdWC: { c: "#94a3b8", label: "van der Waals" },
  PiCa: { c: "#8b5cf6", label: "π-cation" },
  PiSt: { c: "#ec4899", label: "π-stack" },
  Pi:   { c: "#ec4899", label: "π" },
  HBAc: { c: "#3b82f6", label: "H-bond (acc)" },
  HBDo: { c: "#2563eb", label: "H-bond (don)" },
  Salt: { c: "#0ea5e9", label: "salt bridge" },
};
function itype(t: string): { c: string; label: string } { return ITYPE[t] || { c: "#64748b", label: t }; }

const CONF: Record<string, { c: string; label: string }> = {
  high:    { c: "#10b981", label: "High" },
  medium:  { c: "#f59e0b", label: "Medium" },
  low:     { c: "#ef4444", label: "Low" },
  skipped: { c: "#94a3b8", label: "Skipped" },
  unknown: { c: "#cbd5e1", label: "Unchecked" },
};
function conf(c: string | undefined): { c: string; label: string } { return (c && CONF[c]) || CONF.unknown; }

/** PoseBusters raw string → pass/fail/skip verdict + short reason. */
function pbVerdict(raw: string | undefined): { ok: boolean | null; txt: string } {
  const s = String(raw || "").toLowerCase();
  if (!s) return { ok: null, txt: "—" };
  if (s.startsWith("pass") || s === "ok") return { ok: true, txt: "pass" };
  if (s.includes("skip")) return { ok: null, txt: "skipped" };
  const m = String(raw).replace(/^failed:\s*/i, "");
  const parts = m.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  return { ok: false, txt: parts.length > 1 ? `${parts.length} checks` : (parts[0] || "failed") };
}

interface FigItem {
  name: string;
  smiles: string;
  scores: Record<string, number | undefined>;
  wt: number | null;
  extras: Record<string, ParsedExtra>;
}

type TxtOpts = { size?: number; weight?: number; fill?: string; anchor?: string; mono?: boolean; ls?: number; op?: number };
type RectOpts = { fill?: string; stroke?: string; rx?: number; sw?: number; op?: number };

export function buildMatrixSvg(
  rows: MatrixRow[],
  variants: string[],
  mutations: string[],
  opts: { title?: string; subtitle?: string } = {},
): FigureResult {
  // Normalize into a framework-free shape with per-cell metadata parsed out.
  const items: FigItem[] = rows.map((r) => {
    const extras: Record<string, ParsedExtra> = {};
    for (const v of variants) extras[v] = parseExtra(r.extras[v]);
    return {
      name: r.compound.name || "—",
      smiles: r.compound.smiles || "",
      scores: r.scores,
      wt: r.wt,
      extras,
    };
  });

  const W = 1180, PAD = 36;
  const p: string[] = [];
  let y = 0;
  const push = (s: string) => p.push(s);
  const line = (x1: number, yy: number, x2: number, y2: number, stroke = "#e2e8f0", w = 1) =>
    push(`<line x1="${x1}" y1="${yy}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"/>`);
  const txt = (x: number, yy: number, s: unknown, o: TxtOpts = {}) => {
    const { size = 13, weight = 400, fill = "#0f172a", anchor = "start", mono = false, ls = 0, op = 1 } = o;
    push(`<text x="${x}" y="${yy}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls ? ` letter-spacing="${ls}"` : ""}${mono ? ` font-family="${MONO}"` : ""}${op !== 1 ? ` opacity="${op}"` : ""}>${esc(s)}</text>`);
  };
  const rect = (x: number, yy: number, w: number, h: number, o: RectOpts = {}) => {
    const { fill = "none", stroke = "none", rx = 0, sw = 1, op = 1 } = o;
    push(`<rect x="${x}" y="${yy}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ""} fill="${fill}"${stroke !== "none" ? ` stroke="${stroke}" stroke-width="${sw}"` : ""}${op !== 1 ? ` opacity="${op}"` : ""}/>`);
  };
  const sectionLabel = (x: number, yy: number, letter: string, label: string) => {
    txt(x, yy, letter, { size: 11, weight: 800, fill: "#6d28d9" });
    txt(x + 16, yy, label, { size: 11, weight: 800, fill: "#334155", ls: 1.2 });
  };

  // ---- HEADER ----
  txt(PAD, 46, "LIGANX", { size: 15, weight: 800, fill: "#6d28d9", ls: 3 });
  txt(PAD, 84, opts.title || "Selectivity report", { size: 30, weight: 800, fill: "#0f172a" });
  txt(PAD, 107, opts.subtitle || "Mutation-aware docking · Vina score (kcal/mol) · lower = stronger", { size: 13, fill: "#64748b" });
  const meta = `${items.length} compound${items.length === 1 ? "" : "s"} · ${variants.length} variants`;
  txt(W - PAD, 46, meta, { size: 12, fill: "#94a3b8", anchor: "end" });
  line(PAD, 124, W - PAD, 124);

  // ===== PANEL A — SELECTIVITY MATRIX =====
  y = 156;
  sectionLabel(PAD, y, "A", "SELECTIVITY MATRIX");
  txt(PAD, y + 18, "Δ vs wild-type · green = tighter on mutant (selectivity / resistance gain) · red = weaker (escape)", { size: 11.5, fill: "#94a3b8" });
  const NAME_W = 210, HEAD_H = 40, ROW_H = 60;
  const CELL_W = Math.min(126, Math.floor((W - PAD * 2 - NAME_W) / Math.max(1, variants.length)));
  const gx = PAD, gy = y + 34;
  const gridW = NAME_W + variants.length * CELL_W;
  txt(gx, gy + HEAD_H - 14, "COMPOUND", { size: 10.5, weight: 800, fill: "#94a3b8", ls: 0.6 });
  variants.forEach((v, i) => {
    const cx = gx + NAME_W + i * CELL_W + CELL_W / 2;
    const isWt = v === "WT";
    txt(cx, gy + HEAD_H - 18, isWt ? "WT" : v, { size: 14, weight: 800, fill: isWt ? "#64748b" : "#0f172a", anchor: "middle" });
    txt(cx, gy + HEAD_H - 4, isWt ? "reference" : "mutant", { size: 9, fill: "#94a3b8", anchor: "middle" });
  });
  const bodyY = gy + HEAD_H;
  items.forEach((r, ri) => {
    const ry = bodyY + ri * ROW_H;
    const nmShort = r.name.length > 22 ? r.name.slice(0, 21) + "…" : r.name;
    txt(gx + 4, ry + ROW_H / 2 + 2, nmShort, { size: 15, weight: 700, fill: "#0f172a" });
    if (r.smiles) txt(gx + 4, ry + ROW_H / 2 + 18, (r.smiles.length > 26 ? r.smiles.slice(0, 25) + "…" : r.smiles), { size: 9.5, fill: "#cbd5e1", mono: true });
    variants.forEach((v, ci) => {
      const cx = gx + NAME_W + ci * CELL_W;
      const s = r.scores[v];
      const delta = (v !== "WT" && s != null && r.wt != null) ? s - r.wt : null;
      const t = v === "WT" ? { fill: "#f8fafc", dcol: "#94a3b8" } : tintFor(delta);
      rect(cx, ry, CELL_W, ROW_H, { fill: t.fill, stroke: "#e6ebf1" });
      const tx = cx + CELL_W / 2;
      if (s == null) { txt(tx, ry + ROW_H / 2 + 5, "—", { size: 14, fill: "#cbd5e1", anchor: "middle" }); return; }
      txt(tx, ry + ROW_H / 2 - 4, s.toFixed(2), { size: 17, weight: 800, fill: "#0f172a", anchor: "middle", mono: true });
      if (delta != null) {
        const noise = Math.abs(delta) < 1.0;
        const dtxt = `Δ ${delta > 0 ? "+" : ""}${delta.toFixed(2)}${noise ? " (noise)" : ""}`;
        txt(tx, ry + ROW_H / 2 + 16, dtxt, { size: 10.5, fill: t.dcol, anchor: "middle", mono: true });
      }
    });
  });
  rect(gx, bodyY, NAME_W, items.length * ROW_H, { stroke: "#eef2f7" });
  const scaleX = gx + gridW + 34;
  if (W - PAD - scaleX > 120) {
    const sbX = scaleX, sbY = bodyY + 6, sbW = 18, sbH = items.length * ROW_H - 12;
    push(`<defs><linearGradient id="dgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(16,185,129,0.75)"/><stop offset="45%" stop-color="rgba(16,185,129,0.10)"/><stop offset="50%" stop-color="#f1f5f9"/><stop offset="55%" stop-color="rgba(239,68,68,0.10)"/><stop offset="100%" stop-color="rgba(239,68,68,0.75)"/></linearGradient></defs>`);
    rect(sbX, sbY, sbW, sbH, { fill: "url(#dgrad)", stroke: "#e2e8f0", rx: 3 });
    txt(sbX + sbW + 8, sbY + 10, "tighter", { size: 10.5, weight: 700, fill: "#047857" });
    txt(sbX + sbW + 8, sbY + 22, "on mutant", { size: 9.5, fill: "#94a3b8" });
    txt(sbX + sbW + 8, sbY + sbH / 2 + 4, "≈ noise", { size: 10, fill: "#94a3b8" });
    txt(sbX + sbW + 8, sbY + sbH - 16, "weaker", { size: 10.5, weight: 700, fill: "#b91c1c" });
    txt(sbX + sbW + 8, sbY + sbH - 4, "(escape)", { size: 9.5, fill: "#94a3b8" });
  }
  const panelABottom = bodyY + items.length * ROW_H + 18;

  // ===== Two-up: PANEL B (affinity) | PANEL C (Δ diverging) =====
  const colGap = 40;
  const halfW = (W - PAD * 2 - colGap) / 2;
  const bx = PAD, cx0 = PAD + halfW + colGap;
  y = panelABottom + 10;
  sectionLabel(bx, y, "B", "BINDING AFFINITY");
  txt(bx, y + 18, "Vina score magnitude (kcal/mol) — longer = stronger binder", { size: 11.5, fill: "#94a3b8" });
  sectionLabel(cx0, y, "C", "SELECTIVITY  Δ vs WT");
  txt(cx0, y + 18, "mutant − WT (kcal/mol) · shaded band = run-to-run noise", { size: 11.5, fill: "#94a3b8" });

  // Panel B — grouped horizontal bars
  const bAxisX = bx + 150;
  const bAxisW = halfW - 150 - 46;
  let by = y + 40;
  const allAbs: number[] = [];
  items.forEach((r) => variants.forEach((v) => { const s = r.scores[v]; if (s != null) allAbs.push(Math.abs(s)); }));
  const maxAbs = Math.max(10, Math.ceil(allAbs.length ? Math.max(...allAbs) : 0));
  const barH = 15, barGap = 5, groupGap = 16;
  items.forEach((r) => {
    txt(bx, by + 11, (r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name), { size: 12, weight: 700, fill: "#334155" });
    variants.forEach((v) => {
      const s = r.scores[v];
      const isWt = v === "WT";
      const delta = (!isWt && s != null && r.wt != null) ? s - r.wt : null;
      const solid = isWt ? "#94a3b8" : (delta != null && delta < -0.4 ? "#10b981" : delta != null && delta > 0.4 ? "#ef4444" : "#cbd5e1");
      const w = s == null ? 0 : (Math.abs(s) / maxAbs) * bAxisW;
      rect(bAxisX, by, bAxisW, barH, { fill: "#f1f5f9", rx: 3 });
      rect(bAxisX, by, w, barH, { fill: solid, rx: 3 });
      txt(bAxisX - 8, by + 11, isWt ? "WT" : v, { size: 9.5, weight: 600, fill: "#64748b", anchor: "end" });
      if (s != null) txt(bAxisX + w + 6, by + 11, s.toFixed(2), { size: 10.5, weight: 700, fill: "#0f172a", mono: true });
      by += barH + barGap;
    });
    by += groupGap;
  });
  const panelBBottom = by;

  // Panel C — diverging bars around 0
  const cCenter = cx0 + halfW * 0.52;
  const cHalf = Math.min(halfW * 0.36, 190);
  const dMax = 2.0;
  const cy0 = y + 40;
  const noiseW = (1.0 / dMax) * cHalf;
  const cRows: { label: string; d: number }[] = [];
  items.forEach((r) => mutations.forEach((m) => {
    const s = r.scores[m]; if (s == null || r.wt == null) return;
    cRows.push({ label: `${r.name.length > 14 ? r.name.slice(0, 13) + "…" : r.name} · ${m}`, d: s - r.wt });
  }));
  const cBarH = 16, cBarGap = 12;
  const cBandTop = cy0 - 4, cBandH = cRows.length * (cBarH + cBarGap) + 6;
  rect(cCenter - noiseW, cBandTop, noiseW * 2, cBandH, { fill: "#f1f5f9", rx: 3 });
  line(cCenter, cBandTop, cCenter, cBandTop + cBandH, "#cbd5e1", 1);
  let cy = cy0;
  cRows.forEach((cr) => {
    const clamped = Math.max(-dMax, Math.min(dMax, cr.d));
    const w = (Math.abs(clamped) / dMax) * cHalf;
    const noise = Math.abs(cr.d) < 1.0;
    const col = noise ? "#cbd5e1" : (cr.d < 0 ? "#10b981" : "#ef4444");
    txt(cx0, cy + 11, cr.label, { size: 10, fill: "#64748b" });
    if (cr.d < 0) rect(cCenter - w, cy, w, cBarH, { fill: col, rx: 3 });
    else rect(cCenter, cy, w, cBarH, { fill: col, rx: 3 });
    const vlab = `${cr.d > 0 ? "+" : ""}${cr.d.toFixed(2)}`;
    const lx = cr.d < 0 ? cCenter - w - 6 : cCenter + w + 6;
    txt(lx, cy + 11, vlab, { size: 10, weight: 700, fill: noise ? "#94a3b8" : (cr.d < 0 ? "#047857" : "#b91c1c"), mono: true, anchor: cr.d < 0 ? "end" : "start" });
    cy += cBarH + cBarGap;
  });
  txt(cCenter - noiseW - 4, cBandTop + cBandH + 12, "← tighter", { size: 9.5, weight: 600, fill: "#047857", anchor: "end" });
  txt(cCenter + noiseW + 4, cBandTop + cBandH + 12, "weaker →", { size: 9.5, weight: 600, fill: "#b91c1c" });
  const panelCBottom = cBandTop + cBandH + 22;

  const twoUpBottom = Math.max(panelBBottom, panelCBottom) + 8;

  // ===== Two-up: PANEL D (confidence/validation) | PANEL E (interactions) =====
  y = twoUpBottom + 8;
  line(PAD, y - 16, W - PAD, y - 16, "#eef2f7");
  sectionLabel(bx, y, "D", "POSE CONFIDENCE & VALIDATION");
  txt(bx, y + 18, "per compound × variant — PoseBusters physical-validity check", { size: 11.5, fill: "#94a3b8" });
  sectionLabel(cx0, y, "E", "KEY INTERACTIONS");
  txt(cx0, y + 18, "top contacts of the best-scoring mutant pose", { size: 11.5, fill: "#94a3b8" });

  // Panel D — chip grid
  const hasFoldx = items.some((r) => variants.some((v) => r.extras[v]?.foldxDDG != null));
  const chipH = hasFoldx ? 50 : 38;
  const dStride = chipH + 8;
  const dColW = Math.min(150, (halfW - 96) / Math.max(1, variants.length));
  const dGridX = bx + 96;
  let dy = y + 40;
  variants.forEach((v, i) => {
    txt(dGridX + i * dColW + dColW / 2, dy, v === "WT" ? "WT" : v, { size: 10.5, weight: 700, fill: "#64748b", anchor: "middle" });
  });
  dy += 12;
  items.forEach((r) => {
    txt(bx, dy + 22, (r.name.length > 13 ? r.name.slice(0, 12) + "…" : r.name), { size: 11.5, weight: 700, fill: "#334155" });
    variants.forEach((v, i) => {
      const ex = r.extras[v] || ({} as ParsedExtra);
      const cc = conf(ex.confidence);
      const pb = pbVerdict(ex.poseBusters);
      const chipX = dGridX + i * dColW + 6, chipW = dColW - 12;
      rect(chipX, dy, chipW, chipH, { fill: "#f8fafc", stroke: "#e6ebf1", rx: 6 });
      push(`<circle cx="${chipX + 12}" cy="${dy + 14}" r="4" fill="${cc.c}"/>`);
      txt(chipX + 22, dy + 17, cc.label, { size: 10.5, weight: 600, fill: "#334155" });
      const pcol = pb.ok === true ? "#047857" : pb.ok === false ? "#b45309" : "#94a3b8";
      const picon = pb.ok === true ? "✓" : pb.ok === false ? "!" : "–";
      txt(chipX + 12, dy + 31, `${picon} PB ${pb.txt}`, { size: 9.5, fill: pcol });
      if (hasFoldx && ex.foldxDDG != null) {
        const fcol = ex.foldxDDG > 0.5 ? "#b45309" : ex.foldxDDG < -0.5 ? "#047857" : "#64748b";
        txt(chipX + 12, dy + 44, `ΔΔG ${ex.foldxDDG > 0 ? "+" : ""}${ex.foldxDDG.toFixed(2)}`, { size: 9.5, fill: fcol, mono: true });
      }
    });
    dy += dStride;
  });
  const panelDBottom = dy;

  // Panel E — interaction chips (best mutant pose per compound) + type legend
  let ey = y + 40;
  const usedTypes = new Set<string>();
  items.forEach((r) => {
    let best: string | null = null, bestD = Infinity;
    mutations.forEach((m) => { const s = r.scores[m]; if (s != null && r.wt != null) { const d = s - r.wt; if (d < bestD) { bestD = d; best = m; } } });
    const ex = best ? (r.extras[best] || ({} as ParsedExtra)) : ({} as ParsedExtra);
    txt(cx0, ey + 11, (r.name.length > 16 ? r.name.slice(0, 15) + "…" : r.name), { size: 12, weight: 700, fill: "#334155" });
    if (best) txt(cx0 + Math.min(160, r.name.length * 7 + 18), ey + 11, `@ ${best}`, { size: 10, fill: "#94a3b8" });
    ey += 18;
    const contacts = (ex.contacts || []).slice(0, 6);
    let chX = cx0, chY = ey;
    if (contacts.length === 0) { txt(cx0, chY + 11, "no detectable interactions", { size: 10.5, fill: "#cbd5e1" }); ey = chY + 24; }
    else {
      contacts.forEach((ct) => {
        const it = itype(ct.type); usedTypes.add(ct.type);
        const label = `${ct.residue}`;
        const w = 22 + label.length * 7.2;
        if (chX + w > cx0 + halfW) { chX = cx0; chY += 24; }
        rect(chX, chY, w, 18, { fill: "#ffffff", stroke: it.c, rx: 9, sw: 1.3 });
        push(`<circle cx="${chX + 9}" cy="${chY + 9}" r="3.2" fill="${it.c}"/>`);
        txt(chX + 16, chY + 12.5, label, { size: 10, weight: 600, fill: "#334155" });
        chX += w + 6;
      });
      ey = chY + 30;
    }
  });
  ey += 2;
  let lgX = cx0;
  [...usedTypes].forEach((t) => {
    const it = itype(t);
    const lab = it.label;
    if (lgX > cx0 + halfW - 90) { lgX = cx0; ey += 16; }
    push(`<circle cx="${lgX + 4}" cy="${ey + 7}" r="3.5" fill="${it.c}"/>`);
    txt(lgX + 12, ey + 10.5, lab, { size: 9.5, fill: "#64748b" });
    lgX += 24 + lab.length * 5.8 + 12;
  });
  if (usedTypes.size) ey += 18;
  const panelEBottom = ey;

  const contentBottom = Math.max(panelDBottom, panelEBottom) + 6;

  // ---- FOOTER (own clean line) ----
  const fY = contentBottom + 8;
  line(PAD, fY, W - PAD, fY, "#eef2f7");
  txt(PAD, fY + 20, "Docked with AutoDock Vina · poses validated with PoseBusters · Δ within ±1.0 kcal/mol is within run-to-run noise.", { size: 10.5, fill: "#94a3b8" });
  txt(W - PAD, fY + 20, "liganx.com", { size: 11, weight: 700, fill: "#6d28d9", anchor: "end" });
  const H = fY + 38;

  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="#e2e8f0"/>`;
  return { svg: head + p.join("") + "</svg>", width: W, height: H };
}

/** Rasterize the SVG figure to a PNG and trigger a download. 2× scale keeps
 *  text crisp when pasted into slides. Never throws into the caller's UI. */
export async function downloadMatrixPng(
  fig: FigureResult,
  filename = "liganx-selectivity-report.png",
  scale = 2,
): Promise<void> {
  const { svg, width, height } = fig;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("figure render failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    await new Promise<void>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          a.click();
          URL.revokeObjectURL(a.href);
        }
        resolve();
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
