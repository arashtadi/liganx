/**
 * 2D interaction diagram — radial spoke layout.
 *
 * Ligand sits at the center as a labeled disk. Each contacting residue is a
 * label arranged around it on an invisible circle, with a colored line drawn
 * between them. Color encodes interaction type (matching the 3D viewer).
 *
 * Pure SVG, no extra deps. Uses the same parsed contacts the 3D viewer uses.
 */

interface Contact {
  residue: string;
  type: string;
  /** Closest atom-pair distance in Å, when ProLIF reported it. Older runs
   *  before the distance plumbing landed will be undefined and the diagram
   *  silently omits the distance label for those rows. */
  distance?: number;
}

interface Props {
  ligandLabel: string;
  contacts: Contact[];
  className?: string;
}

const COLOR: Record<string, string> = {
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
};

const LABEL: Record<string, string> = {
  HBDonor:     "H-bond",
  HBAcceptor:  "H-bond",
  Hydrophobic: "hydrophobic",
  PiStacking:  "π-stack",
  PiCation:    "π-cation",
  CationPi:    "cation-π",
  Cationic:    "salt bridge",
  Anionic:     "salt bridge",
  XBDonor:     "halogen",
  XBAcceptor:  "halogen",
  VdWContact:  "vdW",
};

function dominantType(types: string[]): string {
  return types.find((t) => t !== "VdWContact") ?? types[0] ?? "VdWContact";
}

export default function InteractionDiagram({ ligandLabel, contacts, className = "" }: Props) {
  // Collapse contacts to one entry per residue: dominant type wins, and we
  // keep the SHORTEST distance across all interactions for that residue (the
  // closest atom-pair tells the most useful story when multiple types coexist).
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
  }));

  if (items.length === 0) {
    return (
      <div className={`text-xs text-slate-400 italic px-3 py-4 text-center dark:text-slate-500 ${className}`}>
        No interactions detected.
      </div>
    );
  }

  // Layout — ligand disk in the centre, residues on a ring around it
  const cx = 200;
  const cy = 160;
  const r = 110;
  const ligandRadius = 32;
  const N = items.length;

  // Distinct colors used → legend
  const usedTypes = Array.from(new Set(items.map((i) => i.type)));

  return (
    <div className={`bg-white rounded-lg border border-slate-200 p-3 dark:bg-slate-800 dark:border-slate-700 ${className}`}>
      <svg viewBox="0 0 400 320" className="w-full" style={{ maxHeight: 320 }}>
        {/* Spokes */}
        {items.map((item, i) => {
          const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
          const x = cx + r * Math.cos(angle);
          const y = cy + r * Math.sin(angle);
          const stroke = COLOR[item.type] ?? "#cbd5e1";
          // Pull the line back from the centre disk so it doesn't punch through
          const x0 = cx + ligandRadius * Math.cos(angle);
          const y0 = cy + ligandRadius * Math.sin(angle);
          // Dashed for VdW (least informative), solid otherwise
          const dash = item.type === "VdWContact" ? "4 3" : undefined;
          return (
            <line key={`L${i}`}
              x1={x0} y1={y0} x2={x} y2={y}
              stroke={stroke} strokeWidth={2.5} strokeDasharray={dash}
              opacity={0.85}
            />
          );
        })}

        {/* Residue labels (and distance below the residue, when available).
            Layout rule: for residues at the top/bottom of the ring (where the
            text would otherwise center on the dot and let the spoke punch
            through the glyphs), we stack the residue name + distance ABOVE
            the dot for top positions and BELOW for bottom. For left/right
            positions we keep the side-anchored layout. */}
        {items.map((item, i) => {
          const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
          const x = cx + r * Math.cos(angle);
          const y = cy + r * Math.sin(angle);
          const fill = COLOR[item.type] ?? "#cbd5e1";

          // Side-anchored layout for non-pole positions (left/right). At the
          // poles (top/bottom) we use middle alignment but offset vertically
          // so the spoke line never crosses the text.
          const isPole = Math.abs(Math.cos(angle)) < 0.3;
          const anchor = isPole ? "middle" : Math.cos(angle) > 0 ? "start" : "end";
          const dx = anchor === "start" ? 10 : anchor === "end" ? -10 : 0;

          // Vertical offsets: residue text first, then distance text below it
          // (or above, when at the top of the ring, so the stack reads
          // "distance / residue / dot").
          const showDist = typeof item.distance === "number";
          let resY: number;
          let distY: number;
          if (isPole && Math.sin(angle) < 0) {
            // Top of the ring: stack labels ABOVE the dot
            //   distance (smaller, higher)
            //   residue  (closer to the dot)
            //   ⬤
            resY = y - 12;
            distY = y - 24;
          } else if (isPole && Math.sin(angle) > 0) {
            // Bottom of the ring: stack BELOW the dot
            //   ⬤
            //   residue
            //   distance
            resY = y + 18;
            distY = y + 30;
          } else {
            // Left/right side: text next to the dot (existing layout)
            resY = y + 4;
            distY = y + 16;
          }

          return (
            <g key={`R${i}`}>
              <circle cx={x} cy={y} r={6} fill={fill} stroke="white" strokeWidth={1.5} />
              <text
                x={x + dx} y={resY}
                textAnchor={anchor as any}
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
                  textAnchor={anchor as any}
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

        {/* Ligand disk */}
        <circle cx={cx} cy={cy} r={ligandRadius}
          fill="#3b6cf6" stroke="white" strokeWidth={3}
        />
        <text
          x={cx} y={cy + 4}
          textAnchor="middle"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize={11}
          fontWeight={700}
          fill="white"
        >
          {ligandLabel.length > 9 ? ligandLabel.slice(0, 8) + "…" : ligandLabel}
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600 mt-2 pt-2 border-t border-slate-100 dark:text-slate-400 dark:border-slate-700">
        {usedTypes.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5" style={{ background: COLOR[t] ?? "#cbd5e1" }} />
            {LABEL[t] ?? t.toLowerCase()}
          </span>
        ))}
        <span className="ml-auto italic text-slate-400 dark:text-slate-500">
          distance = closest atom-pair (Å)
        </span>
      </div>
    </div>
  );
}
