import { useEffect } from "react";

/**
 * ProGateModal — shown when a free-tier user clicks a Pro-only feature
 * (GNINA, Virtual Screening). Explains the gating in one sentence,
 * lists what Pro unlocks, and offers a "Contact us" CTA that routes to
 * the existing /contact page with the feature pre-filled.
 *
 * Stateless / parent owns open state. Renders nothing when feature is
 * null. Closes on Escape, backdrop click, or X.
 *
 * Why a modal and not a toast: this is the moment we ask for money. A
 * toast slides away in 4 seconds; a modal demands attention. Users who
 * dismiss the modal still know exactly what they hit a wall on.
 */

export type ProFeature = "gnina" | "screening";

interface Props {
  feature: ProFeature | null;
  onClose: () => void;
}

const COPY: Record<
  ProFeature,
  { title: string; lede: string; unlocks: string[] }
> = {
  gnina: {
    title: "GNINA docking is a Pro feature",
    lede:
      "Your free Liganx account includes AutoDock Vina docking — fast, physics-based scoring used in hundreds of published papers. GNINA adds a CNN re-rank trained on PDBbind that often discriminates close analogs better.",
    unlocks: [
      "GNINA docking on every Studio run",
      "Mutation-aware virtual screening (rank N compounds × N variants in parallel)",
      "Priority access when the pod is busy",
      "Bigger job quota",
    ],
  },
  screening: {
    title: "Virtual Screening is a Pro feature",
    lede:
      "Your free Liganx account includes single-compound docking. Virtual Screening lets you rank dozens of compounds against a target/mutation pair at once and sorts the hits by selectivity index.",
    unlocks: [
      "Up to 500 compounds per screen (CSV / SDF upload)",
      "Δ-vs-WT selectivity ranking",
      "GNINA re-scoring on top hits",
      "Promote any hit to a full deep-dock with one click",
    ],
  },
};

export default function ProGateModal({ feature, onClose }: Props) {
  // Close on Escape so a power user doesn't have to reach for the
  // mouse. Re-attached every time feature changes so we don't leak the
  // handler when the modal isn't shown.
  useEffect(() => {
    if (!feature) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [feature, onClose]);

  if (!feature) return null;
  const copy = COPY[feature];

  function goToContact() {
    // Route to the existing contact form with the feature pre-filled.
    // The contact page reads the ?subject query param and pre-fills its
    // subject input.
    const subject =
      feature === "gnina"
        ? "Pro upgrade: GNINA access"
        : "Pro upgrade: Virtual Screening access";
    window.location.href = `/contact?subject=${encodeURIComponent(subject)}`;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-gate-title"
      onClick={(e) => {
        // Backdrop click closes; clicks inside the panel do not bubble.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-violet-700/50 bg-slate-950 shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>
              🔒
            </span>
            <h2
              id="pro-gate-title"
              className="text-base font-semibold text-violet-200"
            >
              {copy.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 text-xl leading-none -mt-1"
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-300 leading-relaxed">{copy.lede}</p>

          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-violet-300/70 mb-2">
              Liganx Pro unlocks
            </div>
            <ul className="space-y-1.5">
              {copy.unlocks.map((line) => (
                <li
                  key={line}
                  className="text-sm text-slate-200 flex items-start gap-2"
                >
                  <span className="text-violet-400 mt-0.5">✓</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="text-xs text-slate-400 bg-slate-900/50 rounded border border-slate-800 px-3 py-2">
            Currently in research-preview pricing. Drop us a note about your
            use case and we'll get you set up.
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs font-mono uppercase tracking-[0.18em] text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={goToContact}
            className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-mono uppercase tracking-[0.18em] transition-colors"
          >
            Contact us →
          </button>
        </div>
      </div>
    </div>
  );
}
