/**
 * Publication-style selectivity-matrix figure export.
 *
 * Builds a clean, self-contained SVG of the WT-vs-mutant selectivity matrix
 * (the "money shot" of a Liganx result) and rasterizes it to a PNG the user
 * can drop straight into a slide deck, paper, or Slack — no screenshotting,
 * no dark-UI chrome. Light/print-friendly on purpose.
 *
 * Pure of any framework: takes the same MatrixRow[] the CSV export uses and
 * returns an SVG string + its pixel dimensions. `downloadMatrixPng` handles
 * the SVG→canvas→PNG rasterization (2× by default for crisp text).
 */
import type { MatrixRow } from "../components/CsvExportButton";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Cell background from Δ-vs-WT. Green = tighter on the mutant (selectivity /
 *  resistance gain), red = weaker (escape), neutral inside the noise band.
 *  Mirrors the on-screen matrix so the figure reads the same as the app. */
function cellFill(delta: number | null): string {
  if (delta === null) return "#f8fafc"; // WT column / no data
  if (delta < -0.4) {
    const a = Math.min(0.55, 0.15 + Math.abs(delta) * 0.18);
    return `rgba(16,185,129,${a.toFixed(3)})`;
  }
  if (delta > 0.4) {
    const a = Math.min(0.55, 0.15 + Math.abs(delta) * 0.18);
    return `rgba(239,68,68,${a.toFixed(3)})`;
  }
  return "#f1f5f9"; // within run-to-run noise — no tint
}

export interface FigureResult { svg: string; width: number; height: number; }

export function buildMatrixSvg(
  rows: MatrixRow[],
  variants: string[],
  _mutations: string[],
  opts: { title?: string; subtitle?: string } = {},
): FigureResult {
  const NAME_W = 220;
  const CELL_W = 108;
  const HEAD_H = 94;
  const COLHEAD_H = 42;
  const ROW_H = 54;
  const PAD = 28;
  const LEGEND_H = 56;

  const gridW = NAME_W + variants.length * CELL_W;
  const W = PAD * 2 + gridW;
  const H = HEAD_H + COLHEAD_H + Math.max(1, rows.length) * ROW_H + LEGEND_H + PAD;

  const title = opts.title || "Selectivity matrix";
  const subtitle = opts.subtitle || "Vina score (kcal/mol) · lower = stronger · Δ vs wild-type";
  const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  p.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  p.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="none" stroke="#e2e8f0"/>`);

  // Header — brand wordmark + title + subtitle
  p.push(`<text x="${PAD}" y="32" font-size="14" font-weight="700" letter-spacing="3" fill="#6d28d9">LIGANX</text>`);
  p.push(`<text x="${PAD}" y="60" font-size="22" font-weight="700" fill="#0f172a">${esc(title)}</text>`);
  p.push(`<text x="${PAD}" y="80" font-size="12" fill="#64748b">${esc(subtitle)}</text>`);

  const gridX = PAD;
  const gridY = HEAD_H;

  // Column headers
  p.push(`<text x="${gridX}" y="${gridY + 27}" font-size="10.5" font-weight="700" letter-spacing="0.6" fill="#94a3b8">COMPOUND</text>`);
  variants.forEach((v, i) => {
    const cx = gridX + NAME_W + i * CELL_W + CELL_W / 2;
    const isWt = v === "WT";
    p.push(`<text x="${cx}" y="${gridY + 25}" font-size="13" font-weight="700" text-anchor="middle" fill="${isWt ? "#64748b" : "#0f172a"}">${esc(isWt ? "WT" : v)}</text>`);
    p.push(`<text x="${cx}" y="${gridY + 37}" font-size="9" text-anchor="middle" fill="#94a3b8">${isWt ? "reference" : "mutant"}</text>`);
  });

  // Rows
  const rowsY = gridY + COLHEAD_H;
  rows.forEach((r, ri) => {
    const ry = rowsY + ri * ROW_H;
    const rawName = r.compound.name || "—";
    const name = rawName.length > 24 ? rawName.slice(0, 23) + "…" : rawName;
    p.push(`<text x="${gridX}" y="${ry + ROW_H / 2 + 5}" font-size="14.5" font-weight="600" fill="#0f172a">${esc(name)}</text>`);

    variants.forEach((v, ci) => {
      const cx = gridX + NAME_W + ci * CELL_W;
      const s = r.scores[v];
      const delta = v !== "WT" && s != null && r.wt != null ? s - r.wt : null;
      const fill = v === "WT" ? "#f8fafc" : cellFill(delta);
      p.push(`<rect x="${cx}" y="${ry}" width="${CELL_W}" height="${ROW_H}" fill="${fill}" stroke="#e6ebf1"/>`);
      const tx = cx + CELL_W / 2;
      if (s == null) {
        p.push(`<text x="${tx}" y="${ry + ROW_H / 2 + 5}" font-size="14" text-anchor="middle" fill="#cbd5e1">—</text>`);
        return;
      }
      p.push(`<text x="${tx}" y="${ry + ROW_H / 2 - 3}" font-size="15.5" font-weight="700" text-anchor="middle" fill="#0f172a" font-family="${MONO}">${s.toFixed(2)}</text>`);
      if (delta != null) {
        const noise = Math.abs(delta) < 1.0;
        const dcol = noise ? "#94a3b8" : delta < 0 ? "#047857" : "#b91c1c";
        const dtxt = `Δ ${delta > 0 ? "+" : ""}${delta.toFixed(2)}${noise ? " (noise)" : ""}`;
        p.push(`<text x="${tx}" y="${ry + ROW_H / 2 + 15}" font-size="10" text-anchor="middle" fill="${dcol}" font-family="${MONO}">${esc(dtxt)}</text>`);
      }
    });
  });

  // Left name-column outline
  p.push(`<rect x="${gridX}" y="${rowsY}" width="${NAME_W}" height="${rows.length * ROW_H}" fill="none" stroke="#eef2f7"/>`);

  // Legend + footer
  const ly = rowsY + rows.length * ROW_H + 26;
  p.push(`<rect x="${gridX}" y="${ly - 14}" width="16" height="11" rx="2" fill="rgba(16,185,129,0.45)"/>`);
  p.push(`<text x="${gridX + 24}" y="${ly - 4}" font-size="11" fill="#475569">tighter on mutant (selectivity / resistance gain)</text>`);
  p.push(`<rect x="${gridX + 350}" y="${ly - 14}" width="16" height="11" rx="2" fill="rgba(239,68,68,0.45)"/>`);
  p.push(`<text x="${gridX + 374}" y="${ly - 4}" font-size="11" fill="#475569">weaker on mutant (escape)</text>`);
  p.push(`<text x="${W - PAD}" y="${ly - 4}" font-size="10" text-anchor="end" fill="#94a3b8">|Δ| &lt; 1.0 kcal/mol ≈ within Vina noise  ·  liganx.com</text>`);

  p.push(`</svg>`);
  return { svg: p.join(""), width: W, height: H };
}

/** Rasterize the SVG figure to a PNG and trigger a download. 2× scale keeps
 *  text crisp when pasted into slides. Never throws into the caller's UI. */
export async function downloadMatrixPng(
  fig: FigureResult,
  filename = "liganx-selectivity-matrix.png",
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
