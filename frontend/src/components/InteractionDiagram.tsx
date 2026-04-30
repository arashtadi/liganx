/**
 * Interactive 2D ligand-interaction diagram (Maestro-style).
 *
 * Layout: central ligand disk + radial spokes to each contacting residue.
 * Residue dots are colored by amino-acid CHEMISTRY (hydrophobic, polar,
 * charged±, aromatic, special), not by interaction type — so a single
 * glance tells you both the chemistry of the binding pocket residues AND
 * the type of contact they make (encoded by line color + style).
 *
 * Interactivity:
 *   - Hover a residue          → highlight all its contacts; show tooltip
 *                                 with full residue name + chemistry class +
 *                                 list of interactions made
 *   - Hover a contact line     → tooltip with type + distance
 *   - Click a residue          → fires onResidueClick(residue); parent (e.g.
 *                                 PoseDetail) can sync the 3D viewer
 *
 * Pure SVG + a single floating tooltip div. No extra deps.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Contact {
  residue: string;
  type: string;
  /** Closest atom-pair distance in Å, when ProLIF reported it. */
  distance?: number;
}

interface Props {
  ligandLabel: string;
  contacts: Contact[];
  className?: string;
  /** Fired when the user clicks a residue dot. Parent can wire this to
   *  focus / highlight the same residue in the 3D viewer. */
  onResidueClick?: (residue: string) => void;
}

/* ───────────────────── Interaction type styling ──────────────────── */

// Both forms of each interaction-type code are mapped because the backend's
// `to_extra_string` truncates ProLIF's full name to its first 4 chars to keep
// the `extra` field compact (e.g. "Hydrophobic" → "Hydr", "HBAcceptor" →
// "HBAc", "VdWContact" → "VdWC"). The 4-char form is what actually arrives
// from the API today; the long forms stay for any direct ProLIF caller.
const COLOR: Record<string, string> = {
  // Full ProLIF names
  HBDonor:       "#10b981",
  HBAcceptor:    "#10b981",
  Hydrophobic:   "#eab308",
  PiStacking:    "#a855f7",
  PiCation:      "#a855f7",
  CationPi:      "#a855f7",
  Cationic:      "#f97316",
  Anionic:       "#f97316",
  XBDonor:       "#06b6d4",
  XBAcceptor:    "#06b6d4",
  MetalDonor:    "#94a3b8",
  MetalAcceptor: "#94a3b8",
  VdWContact:    "#cbd5e1",
  // 4-char API forms (what we actually receive)
  HBDo: "#10b981", HBAc: "#10b981",
  Hydr: "#eab308",
  PiSt: "#a855f7", PiCa: "#a855f7", Cati: "#a855f7",  // Cati matches Cation*
  Anio: "#f97316",
  XBDo: "#06b6d4", XBAc: "#06b6d4",
  Meta: "#94a3b8",
  VdWC: "#cbd5e1",
};

const LABEL: Record<string, string> = {
  HBDonor:       "H-bond donor",
  HBAcceptor:    "H-bond acceptor",
  Hydrophobic:   "hydrophobic",
  PiStacking:    "π-stacking",
  PiCation:      "π-cation",
  CationPi:      "cation-π",
  Cationic:      "salt bridge (+)",
  Anionic:       "salt bridge (−)",
  XBDonor:       "halogen donor",
  XBAcceptor:    "halogen acceptor",
  MetalDonor:    "metal coord.",
  MetalAcceptor: "metal coord.",
  VdWContact:    "van der Waals",
  HBDo: "H-bond donor",
  HBAc: "H-bond acceptor",
  Hydr: "hydrophobic",
  PiSt: "π-stacking",
  PiCa: "π-cation",
  Cati: "cation-π",
  Anio: "salt bridge (−)",
  XBDo: "halogen donor",
  XBAc: "halogen acceptor",
  Meta: "metal coord.",
  VdWC: "van der Waals",
};

/** Per-type line style — Maestro convention. Accepts both the full ProLIF
 *  name and the 4-char API form (Hydr, HBAc, VdWC, …). */
function lineStyleFor(type: string): { dash?: string; width: number } {
  switch (type) {
    case "HBDonor": case "HBDo":
    case "HBAcceptor": case "HBAc":
      return { dash: "5 3", width: 2.5 };          // dashed
    case "Hydrophobic": case "Hydr":
      return { dash: "1 4", width: 2.0 };          // dotted
    case "PiStacking": case "PiSt":
    case "PiCation": case "PiCa":
    case "CationPi": case "Cati":
      return { dash: "10 2 2 2", width: 2.5 };     // dash-dot for π
    case "Cationic":
    case "Anionic": case "Anio":
      return { dash: undefined, width: 3.5 };      // thick solid for salt
    case "XBDonor": case "XBDo":
    case "XBAcceptor": case "XBAc":
      return { dash: "8 2", width: 2.5 };          // long dash for halogen
    case "VdWContact": case "VdWC":
      return { dash: "1 5", width: 1.5 };          // very faint dotted
    default:
      return { dash: undefined, width: 2.0 };
  }
}

/* ─────────────────── Residue chemistry classification ──────────────── */

type ResChem = {
  /** Full English name. */
  full: string;
  /** Chemistry class — drives the dot color. */
  cls: "hydrophobic" | "polar" | "positive" | "negative" | "aromatic" | "special" | "unknown";
};

// Three-letter → (full name, chemistry class). HIS classed as positive
// because at physiological pH it can carry +1; tag separately if needed.
const AMINO: Record<string, ResChem> = {
  ALA: { full: "Alanine",       cls: "hydrophobic" },
  GLY: { full: "Glycine",       cls: "special" },
  VAL: { full: "Valine",        cls: "hydrophobic" },
  LEU: { full: "Leucine",       cls: "hydrophobic" },
  ILE: { full: "Isoleucine",    cls: "hydrophobic" },
  MET: { full: "Methionine",    cls: "hydrophobic" },
  PRO: { full: "Proline",       cls: "special" },
  PHE: { full: "Phenylalanine", cls: "aromatic" },
  TRP: { full: "Tryptophan",    cls: "aromatic" },
  TYR: { full: "Tyrosine",      cls: "aromatic" },
  SER: { full: "Serine",        cls: "polar" },
  THR: { full: "Threonine",     cls: "polar" },
  ASN: { full: "Asparagine",    cls: "polar" },
  GLN: { full: "Glutamine",     cls: "polar" },
  CYS: { full: "Cysteine",      cls: "special" },
  HIS: { full: "Histidine",     cls: "positive" },
  LYS: { full: "Lysine",        cls: "positive" },
  ARG: { full: "Arginine",      cls: "positive" },
  ASP: { full: "Aspartate",     cls: "negative" },
  GLU: { full: "Glutamate",     cls: "negative" },
};

const CHEM_COLOR: Record<ResChem["cls"], string> = {
  hydrophobic: "#84cc16",   // green
  polar:       "#06b6d4",   // cyan
  positive:    "#3b82f6",   // blue
  negative:    "#ef4444",   // red
  aromatic:    "#a855f7",   // purple
  special:     "#94a3b8",   // grey (Gly, Pro, Cys)
  unknown:     "#cbd5e1",   // light grey fallback
};

const CHEM_LABEL: Record<ResChem["cls"], string> = {
  hydrophobic: "hydrophobic",
  polar:       "polar (uncharged)",
  positive:    "positively charged",
  negative:    "negatively charged",
  aromatic:    "aromatic",
  special:     "special (Gly/Pro/Cys)",
  unknown:     "—",
};

/** Parse "MET793" or "Met793.A" into 3-letter + number. */
function parseResidue(res: string): { code: string; num: string } {
  const m = res.match(/^([A-Za-z]{3})(\d+.*)$/);
  if (!m) return { code: res, num: "" };
  return { code: m[1].toUpperCase(), num: m[2] };
}

function residueChem(res: string): ResChem {
  const { code } = parseResidue(res);
  return AMINO[code] ?? { full: code || res, cls: "unknown" };
}

function dominantType(types: string[]): string {
  return types.find((t) => t !== "VdWContact") ?? types[0] ?? "VdWContact";
}

/* ────────────────────────── component ────────────────────────────── */

export default function InteractionDiagram({
  ligandLabel, contacts, className = "", onResidueClick,
}: Props) {
  // Aggregate contacts per residue (closest distance wins; collect all types)
  type Agg = { types: string[]; distance: number | undefined };
  const byRes = new Map<string, Agg>();
  for (const c of contacts) {
    const cur = byRes.get(c.residue) ?? { types: [], distance: undefined };
    cur.types.push(c.type);
    if (c.distance != null) {
      cur.distance = cur.distance == null ? c.distance : Math.min(cur.distance, c.distance);
    }
    byRes.set(c.residue, cur);
  }
  const items = Array.from(byRes.entries()).map(([residue, agg]) => ({
    residue,
    type: dominantType(agg.types),
    types: agg.types,
    distance: agg.distance,
    chem: residueChem(residue),
  }));

  // Hover state for highlighting + tooltip
  const [hover, setHover] = useState<{
    kind: "residue" | "contact";
    index: number;
    x: number;
    y: number;
  } | null>(null);

  // Fullscreen toggle. When true, the diagram body is portaled into a
  // fullscreen overlay so the SVG can scale up well past the inline
  // ~340 px cap. Esc dismisses; body scroll is locked while open.
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  if (items.length === 0) {
    return (
      <div className={`text-xs text-slate-400 italic px-3 py-4 text-center dark:text-slate-500 ${className}`}>
        No interactions detected.
      </div>
    );
  }

  // Layout
  const cx = 200;
  const cy = 160;
  const r = 110;
  const ligandRadius = 32;
  const N = items.length;

  // Distinct interaction types in this view → line legend
  const usedTypes = Array.from(new Set(items.map((i) => i.type)));
  // Distinct residue chemistry classes → dot legend
  const usedChems = Array.from(new Set(items.map((i) => i.chem.cls)));

  // Build the tooltip content for whichever element is hovered.
  let tip: { title: string; lines: string[] } | null = null;
  if (hover) {
    const item = items[hover.index];
    if (hover.kind === "residue") {
      tip = {
        title: `${item.residue} — ${item.chem.full}`,
        lines: [
          `Class: ${CHEM_LABEL[item.chem.cls]}`,
          `Interactions: ${Array.from(new Set(item.types)).map((t) => LABEL[t] ?? t).join(", ")}`,
          ...(item.distance != null ? [`Closest contact: ${item.distance.toFixed(2)} Å`] : []),
        ],
      };
    } else {
      tip = {
        title: `${item.residue} ↔ ligand`,
        lines: [
          `${LABEL[item.type] ?? item.type}`,
          ...(item.distance != null ? [`Distance: ${item.distance.toFixed(2)} Å`] : []),
          ...(item.types.length > 1
            ? [`Other interactions at this residue: ${item.types
                .filter((t) => t !== item.type)
                .map((t) => LABEL[t] ?? t)
                .join(", ")}`]
            : []),
        ],
      };
    }
  }

  // SVG height cap — small inline; uncapped (fills viewport) in fullscreen.
  // The viewBox stays 400×320 so existing geometry/labels just scale up.
  const svgMaxHeight = fullscreen ? "calc(100vh - 8rem)" : 340;

  // Body — extracted so it can be rendered identically inline OR inside the
  // fullscreen portal. Includes the SVG + tooltip + legends. The fullscreen
  // toggle button itself stays *outside* the body so the inline wrapper and
  // the fullscreen wrapper each render their own (with different icons +
  // titles).
  const body = (
    <>
      <svg
        viewBox="0 0 400 320"
        className="w-full"
        style={{ maxHeight: svgMaxHeight }}
        onMouseLeave={() => setHover(null)}
      >
        {/* ── defs: gradients, filters, animations ─────────────────────── */}
        <defs>
          {/* Ligand-center radial gradient — deep indigo core → soft fade. */}
          <radialGradient id="ligandFill" cx="0.4" cy="0.35" r="0.85">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="55%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#312e81" />
          </radialGradient>
          {/* Soft outer halo for the ligand */}
          <radialGradient id="ligandHalo" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.45" />
            <stop offset="60%" stopColor="#6366f1" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>
          {/* Glow filter for hovered spokes / dots — uses Gaussian blur on a
              copy of the source and composites it back on top. Keeps the
              line's color but adds a soft chromatic haze. */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Subtle drop shadow under residue dots so they pop off the panel. */}
          <filter id="dotShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#0f172a" floodOpacity="0.35" />
          </filter>
        </defs>

        {/* ── Decorative pocket ring + halo, behind everything ─────────── */}
        {/* Faint dashed circle at the residue radius — gives the map a sense
            of "binding pocket boundary" without claiming structural meaning. */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.08}
          strokeWidth={1}
          strokeDasharray="2 4"
          className="text-slate-500"
        />
        {/* Soft glow under the ligand — reads as "this is where the action is" */}
        <circle cx={cx} cy={cy} r={ligandRadius * 2.2} fill="url(#ligandHalo)" />

        {/* Spokes (rendered first so dots + labels stack on top) */}
        {items.map((item, i) => {
          const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
          const x = cx + r * Math.cos(angle);
          const y = cy + r * Math.sin(angle);
          const stroke = COLOR[item.type] ?? "#cbd5e1";
          const x0 = cx + ligandRadius * Math.cos(angle);
          const y0 = cy + ligandRadius * Math.sin(angle);
          const style = lineStyleFor(item.type);
          // Dim other lines when something is hovered
          const isHighlighted = hover && hover.index === i;
          const isFaded = hover && hover.index !== i;
          return (
            <g key={`L${i}`}>
              {/* Wider invisible hit target so tooltips fire on near-misses */}
              <line
                x1={x0} y1={y0} x2={x} y2={y}
                stroke="transparent"
                strokeWidth={14}
                onMouseMove={(e) => setHover({ kind: "contact", index: i, x: e.clientX, y: e.clientY })}
                onMouseEnter={(e) => setHover({ kind: "contact", index: i, x: e.clientX, y: e.clientY })}
                style={{ cursor: "help" }}
              />
              {/* Visible line. Highlighted spokes get a chromatic glow via
                  the SVG filter — gives a sense of "active connection" that
                  flat lines can't. */}
              <line
                x1={x0} y1={y0} x2={x} y2={y}
                stroke={stroke}
                strokeWidth={isHighlighted ? style.width + 0.5 : style.width}
                strokeDasharray={style.dash}
                strokeLinecap="round"
                opacity={isHighlighted ? 1 : isFaded ? 0.18 : 0.78}
                filter={isHighlighted ? "url(#glow)" : undefined}
                style={{ pointerEvents: "none", transition: "opacity .12s, stroke-width .12s" }}
              />
              {/* H-bond gets an arrowhead on the residue end (acceptor → donor convention) */}
              {(item.type === "HBDonor" || item.type === "HBAcceptor") && (
                <circle
                  cx={x - (x - x0) * 0.12}
                  cy={y - (y - y0) * 0.12}
                  r={2.5}
                  fill={stroke}
                  opacity={isHighlighted ? 1 : isFaded ? 0.2 : 0.85}
                  style={{ pointerEvents: "none" }}
                />
              )}
            </g>
          );
        })}

        {/* Residue labels + chemistry-colored dots */}
        {items.map((item, i) => {
          const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
          const x = cx + r * Math.cos(angle);
          const y = cy + r * Math.sin(angle);
          const dotFill = CHEM_COLOR[item.chem.cls];

          // Same anti-collision layout as before
          const isPole = Math.abs(Math.cos(angle)) < 0.3;
          const anchor = isPole ? "middle" : Math.cos(angle) > 0 ? "start" : "end";
          const dx = anchor === "start" ? 10 : anchor === "end" ? -10 : 0;
          const showDist = typeof item.distance === "number";
          let resY: number;
          let distY: number;
          if (isPole && Math.sin(angle) < 0) {
            resY = y - 12;
            distY = y - 24;
          } else if (isPole && Math.sin(angle) > 0) {
            resY = y + 18;
            distY = y + 30;
          } else {
            resY = y + 4;
            distY = y + 16;
          }

          const isHighlighted = hover && hover.index === i;
          const isFaded = hover && hover.index !== i;

          return (
            <g
              key={`R${i}`}
              onMouseMove={(e) => setHover({ kind: "residue", index: i, x: e.clientX, y: e.clientY })}
              onMouseEnter={(e) => setHover({ kind: "residue", index: i, x: e.clientX, y: e.clientY })}
              onClick={() => onResidueClick?.(item.residue)}
              style={{
                cursor: onResidueClick ? "pointer" : "help",
                opacity: isFaded ? 0.35 : 1,
                transition: "opacity .12s",
              }}
            >
              {/* Glow halo on hover — chromatic ring that pulses outward.
                  Two concentric circles: outer faint (more saturated colour),
                  inner brighter ring framing the dot. */}
              {isHighlighted && (
                <>
                  <circle cx={x} cy={y} r={14} fill={dotFill} opacity={0.18} filter="url(#glow)" />
                  <circle cx={x} cy={y} r={10.5} fill="none" stroke={dotFill} strokeWidth={1.25} opacity={0.7} />
                </>
              )}
              {/* Dot itself — slightly larger, with subtle drop shadow so it
                  reads as floating above the panel. White ring keeps it
                  legible regardless of dark/light theme. */}
              <circle
                cx={x} cy={y} r={7.5}
                fill={dotFill}
                stroke="white" strokeWidth={1.75}
                filter="url(#dotShadow)"
                style={{ transition: "r .12s" }}
              />
              <text
                x={x + dx} y={resY}
                textAnchor={anchor as "start" | "middle" | "end"}
                fontFamily="ui-monospace, monospace"
                fontSize={11}
                fontWeight={600}
                fill="currentColor"
                className="dark:fill-slate-100"
              >
                {item.residue}
              </text>
              {showDist && (
                <text
                  x={x + dx} y={distY}
                  textAnchor={anchor as "start" | "middle" | "end"}
                  fontFamily="ui-monospace, monospace"
                  fontSize={9.5}
                  fontWeight={500}
                  fill="#94a3b8"
                  className="dark:fill-slate-400"
                >
                  {item.distance!.toFixed(1)} Å
                </text>
              )}
            </g>
          );
        })}

        {/* Ligand disk — radial-gradient indigo with a soft outer glow ring.
            Stacks: faint outer ring (depth) → main filled disk → label.
            Uses the gradient defined in <defs> so the disk has a 3D-ish
            sphere quality rather than the flat #3b6cf6 fill of v1. */}
        <circle
          cx={cx} cy={cy} r={ligandRadius + 4}
          fill="none" stroke="#6366f1" strokeWidth={1.5} strokeOpacity={0.35}
        />
        <circle
          cx={cx} cy={cy} r={ligandRadius}
          fill="url(#ligandFill)"
          stroke="white" strokeWidth={3}
          filter="url(#dotShadow)"
        />
        <text
          x={cx} y={cy + 4}
          textAnchor="middle"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize={11}
          fontWeight={700}
          fill="white"
          letterSpacing="0.2"
        >
          {ligandLabel.length > 9 ? ligandLabel.slice(0, 8) + "…" : ligandLabel}
        </text>
      </svg>

      {/* Floating tooltip — uses fixed positioning so it escapes the SVG and any parent overflow:hidden */}
      {tip && (
        <div
          className="fixed z-50 pointer-events-none rounded-md bg-slate-900 text-white text-[11px] leading-snug px-2.5 py-1.5 shadow-lg ring-1 ring-slate-700 max-w-[260px] dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-300"
          style={{
            left: hover!.x + 14,
            top: hover!.y + 14,
          }}
        >
          <div className="font-semibold mb-0.5">{tip.title}</div>
          {tip.lines.map((l, i) => (
            <div key={i} className="opacity-90">{l}</div>
          ))}
        </div>
      )}

      {/* Two-row legend: residue chemistry, then interaction-line styles */}
      <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-700 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-500 dark:text-slate-400 mr-1">Residue:</span>
          {usedChems.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: CHEM_COLOR[c] }} />
              {CHEM_LABEL[c]}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-500 dark:text-slate-400 mr-1">Contact:</span>
          {usedTypes.map((t) => {
            const style = lineStyleFor(t);
            return (
              <span key={t} className="inline-flex items-center gap-1.5">
                <svg width={20} height={6} className="shrink-0">
                  <line
                    x1={0} y1={3} x2={20} y2={3}
                    stroke={COLOR[t] ?? "#cbd5e1"}
                    strokeWidth={style.width}
                    strokeDasharray={style.dash}
                  />
                </svg>
                {LABEL[t] ?? t.toLowerCase()}
              </span>
            );
          })}
        </div>
        <div className="text-[10px] text-slate-400 dark:text-slate-500 italic">
          {onResidueClick
            ? "Hover any line for details · click a residue to focus it in the 3D view"
            : "Hover any line for details"}
        </div>
      </div>
    </>
  );

  // Small fullscreen toggle in the top-right corner. Same icon shape (4
  // corner brackets) familiar from photo viewers / video players. The
  // button sits absolutely over the diagram so it doesn't reflow the
  // existing layout. We render BOTH instances (inline and inside the
  // fullscreen modal) — the inline one toggles fullscreen ON, the
  // modal's toggle button toggles it OFF.
  const ExpandIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
    </svg>
  );
  const CollapseIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
    </svg>
  );

  // Inline render — the diagram as it appears inside the page/rail.
  const inline = (
    <div
      className={`relative rounded-xl border border-slate-200 p-3 overflow-hidden bg-gradient-to-br from-white via-white to-indigo-50/40 dark:from-slate-800 dark:via-slate-800 dark:to-indigo-950/40 dark:border-slate-700 ${className}`}
    >
      <button
        type="button"
        onClick={() => setFullscreen(true)}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-md text-slate-400 hover:text-ink hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-slate-700 transition-colors"
        title="Open in full screen"
        aria-label="Open in full screen"
      >
        <ExpandIcon />
      </button>
      {body}
    </div>
  );

  if (!fullscreen) return inline;

  // Fullscreen render — portaled to body so it covers any parent
  // overflow / stacking contexts. Backdrop click + Esc dismiss.
  return (
    <>
      {inline}
      {createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-ink/80 backdrop-blur-sm"
          onClick={() => setFullscreen(false)}
        >
          <div
            className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 w-full max-w-6xl max-h-[95vh] overflow-y-auto p-4 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-ink dark:text-slate-100">
                2D interaction map · {ligandLabel}
              </div>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                className="p-1.5 rounded-md text-slate-500 hover:text-ink hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700 transition-colors"
                title="Exit full screen (Esc)"
                aria-label="Exit full screen"
              >
                <CollapseIcon size={16} />
              </button>
            </div>
            {body}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
