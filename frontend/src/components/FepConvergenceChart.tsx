/**
 * FepConvergenceChart — (W1) live ΔΔG convergence plot for one FEP edge.
 *
 * Plots the partial-MBAR ΔΔG estimate (line) and its 95% confidence band
 * (shaded) as sampling accumulates, so a user watches the estimate settle
 * and the band shrink. Real data only — fed by the edge's `ddg_history`
 * time series (backend W1). Renders an honest empty state until the first
 * window reports, so there's never a fake number on screen.
 *
 * Hand-rolled inline SVG (no chart lib) to match the perturbation-map
 * style and keep the bundle lean. Dark-theme-native — the FEP study page
 * is dark.
 */

export interface ConvergencePoint {
  t: number | null;   // sampling accumulated (ns); falls back to poll index
  ddg: number | null;  // partial ΔΔG_binding, kcal/mol
  ci: number | null;   // 95% CI half-width, kcal/mol
}

interface Props {
  history: ConvergencePoint[];
  /** Convergence threshold on the CI half-width (kcal/mol). The MBAR
   *  protocol calls an edge converged once the 95% CI is at or below
   *  this. Used only to colour the "converged?" verdict. */
  ciThreshold?: number;
  running?: boolean;
}

const W = 560;
const H = 240;
const PAD_L = 48;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 34;

export default function FepConvergenceChart({ history, ciThreshold = 0.4, running = false }: Props) {
  const pts = (history || []).filter(
    (p) => p && typeof p.ddg === "number" && isFinite(p.ddg as number),
  ) as { t: number | null; ddg: number; ci: number | null }[];

  if (pts.length === 0) {
    return (
      <div
        className="rounded-lg border border-slate-700/70 bg-slate-900/40 flex items-center justify-center text-center px-4"
        style={{ minHeight: 150 }}
      >
        <div className="text-[12px] text-slate-400 leading-relaxed max-w-sm">
          {running ? (
            <>
              <span className="font-semibold text-slate-300">Convergence — sampling.</span>{" "}
              The ΔΔG estimate appears once the first λ-window reports a
              partial-MBAR result. No estimate is shown before then (it
              would be meaningless this early).
            </>
          ) : (
            <>No live convergence data was recorded for this edge.</>
          )}
        </div>
      </div>
    );
  }

  // x axis: use t when present, else point index.
  const xs = pts.map((p, i) => (typeof p.t === "number" ? (p.t as number) : i));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin || 1;

  // y axis: span the band (ddg ± ci), with a little padding.
  const lows = pts.map((p) => p.ddg - (p.ci ?? 0));
  const highs = pts.map((p) => p.ddg + (p.ci ?? 0));
  let yMin = Math.min(...lows);
  let yMax = Math.max(...highs);
  const yPad = (yMax - yMin) * 0.12 || 0.5;
  yMin -= yPad;
  yMax += yPad;
  const ySpan = yMax - yMin || 1;

  const xPix = (x: number) => PAD_L + ((x - xMin) / xSpan) * (W - PAD_L - PAD_R);
  const yPix = (y: number) => PAD_T + (1 - (y - yMin) / ySpan) * (H - PAD_T - PAD_B);

  const linePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xPix(xs[i]).toFixed(1)} ${yPix(p.ddg).toFixed(1)}`)
    .join(" ");

  // CI band: upper edge left→right, then lower edge right→left.
  const bandPath =
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xPix(xs[i]).toFixed(1)} ${yPix(p.ddg + (p.ci ?? 0)).toFixed(1)}`).join(" ") +
    " " +
    pts.slice().reverse().map((p, j) => {
      const i = pts.length - 1 - j;
      return `L ${xPix(xs[i]).toFixed(1)} ${yPix(p.ddg - (p.ci ?? 0)).toFixed(1)}`;
    }).join(" ") +
    " Z";

  const last = pts[pts.length - 1];
  const lastX = xPix(xs[xs.length - 1]);
  const lastY = yPix(last.ddg);
  const converged = last.ci != null && last.ci <= ciThreshold;

  // y gridlines / labels — 4 ticks.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * ySpan);
  const hasT = typeof pts[0].t === "number";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[13px] font-mono">
          ΔΔG ={" "}
          <span className="font-semibold text-slate-100">
            {last.ddg > 0 ? "+" : ""}{last.ddg.toFixed(2)}
          </span>
          {last.ci != null && (
            <span className="text-slate-400"> ± {last.ci.toFixed(2)}</span>
          )}
          <span className="text-slate-500 text-[11px]"> kcal/mol</span>
        </div>
        {last.ci != null && (
          <span
            className={
              "text-[10px] px-2 py-0.5 rounded-full border " +
              (converged
                ? "border-emerald-500/50 text-emerald-300 bg-emerald-950/30"
                : "border-amber-500/40 text-amber-300 bg-amber-950/20")
            }
          >
            {converged ? "● converged" : `◐ CI ${last.ci.toFixed(2)} > ${ciThreshold}`}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 mb-1.5 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><span style={{ width: 14, height: 3, borderRadius: 2, background: "#1D9E75", display: "inline-block" }} />ΔΔG estimate</span>
        <span className="flex items-center gap-1.5"><span style={{ width: 14, height: 10, borderRadius: 2, background: "rgba(29,158,117,0.18)", display: "inline-block" }} />95% confidence band</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
           aria-label={`FEP convergence chart. Latest ΔΔG estimate ${last.ddg.toFixed(2)} kcal/mol${last.ci != null ? ` plus or minus ${last.ci.toFixed(2)}` : ""}.`}>
        {yTicks.map((yt, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={yPix(yt)} x2={W - PAD_R} y2={yPix(yt)}
                  stroke="rgba(148,163,184,0.15)" strokeWidth={1} />
            <text x={PAD_L - 6} y={yPix(yt) + 3} textAnchor="end"
                  fontSize="10" fontFamily="ui-monospace, monospace" fill="rgba(148,163,184,0.8)">
              {yt.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={bandPath} fill="rgba(29,158,117,0.18)" stroke="none" />
        <path d={linePath} fill="none" stroke="#1D9E75" strokeWidth={2.5}
              strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lastX} cy={lastY} r={running ? 5 : 4} fill="#1D9E75" />
        {running && (
          <circle cx={lastX} cy={lastY} r={5} fill="none" stroke="#1D9E75" strokeWidth={1.5}>
            <animate attributeName="r" from="5" to="11" dur="1.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.7" to="0" dur="1.4s" repeatCount="indefinite" />
          </circle>
        )}
        <text x={(PAD_L + W - PAD_R) / 2} y={H - 8} textAnchor="middle"
              fontSize="10" fontFamily="ui-monospace, monospace" fill="rgba(148,163,184,0.8)">
          {hasT ? "sampling accumulated (ns)" : "polls"}
        </text>
        <text x={12} y={PAD_T + (H - PAD_T - PAD_B) / 2} textAnchor="middle"
              fontSize="10" fontFamily="ui-monospace, monospace" fill="rgba(148,163,184,0.8)"
              transform={`rotate(-90 12 ${PAD_T + (H - PAD_T - PAD_B) / 2})`}>
          ΔΔG (kcal/mol)
        </text>
      </svg>
    </div>
  );
}
