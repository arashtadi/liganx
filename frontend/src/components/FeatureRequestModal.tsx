import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * FeatureRequestModal — the single "Request access" modal used by every
 * gated Studio feature (AI Resistance / GNINA / Virtual Screening). Replaces
 * the old ProGateModal "contact us" flow: it fires an in-app request
 * (POST /me/request-access/<feature>) that pings the operator on Telegram
 * with Approve/Deny, then shows a "pending" confirmation. Parent owns the
 * open flag and is told the new state via onRequested so it can flip the
 * button to "pending".
 */
export type GatedFeature = "boltz2" | "gnina" | "screening";

interface Props {
  feature: GatedFeature | null;
  onClose: () => void;
  onRequested?: (feature: GatedFeature, newStatus: string) => void;
}

const ACCENT: Record<string, {
  border: string; h2: string; chip: string; check: string; label: string; btn: string;
}> = {
  teal: {
    border: "border-teal-700/50", h2: "text-teal-200",
    chip: "bg-teal-500/10 text-teal-300", check: "text-teal-400",
    label: "text-teal-300/70", btn: "bg-teal-600 hover:bg-teal-500",
  },
  violet: {
    border: "border-violet-700/50", h2: "text-violet-200",
    chip: "bg-violet-500/10 text-violet-300", check: "text-violet-400",
    label: "text-violet-300/70", btn: "bg-violet-600 hover:bg-violet-500",
  },
  cyan: {
    border: "border-cyan-700/50", h2: "text-cyan-200",
    chip: "bg-cyan-500/10 text-cyan-300", check: "text-cyan-400",
    label: "text-cyan-300/70", btn: "bg-cyan-600 hover:bg-cyan-500",
  },
};

const COPY: Record<GatedFeature, {
  emoji: string; title: string; accent: keyof typeof ACCENT; lede: string; bullets: string[];
}> = {
  boltz2: {
    emoji: "🧬", title: "AI Resistance Prediction", accent: "teal",
    lede:
      "AI Resistance Prediction uses a deep-learning co-folding model (Boltz-2) to predict how a mutation changes a drug's binding — the resistance question — from sequence alone, no fixed structure required. It's in limited early access while we validate and scale the GPU pipeline.",
    bullets: [
      "Wild-type vs. mutant binding-affinity prediction",
      "A predicted 3D complex for each run",
      "A calibrated resistance signal, strongest on gatekeeper mutations",
    ],
  },
  gnina: {
    emoji: "🧪", title: "GNINA Docking", accent: "violet",
    lede:
      "GNINA adds a CNN re-scoring pass on top of AutoDock Vina, trained on PDBbind — it often discriminates close analogs better than physics scoring alone. It's compute-heavier, so it's access-gated.",
    bullets: [
      "CNN-rescored poses on every Studio run",
      "Better ranking of structurally similar compounds",
      "Same mutation-aware wild-type vs. mutant workflow",
    ],
  },
  screening: {
    emoji: "🔬", title: "Virtual Screening", accent: "cyan",
    lede:
      "Virtual Screening ranks dozens of compounds against a target/mutation pair in a single run, sorted by selectivity index (mutant tighter than WT). It's the high-throughput path to a shortlist.",
    bullets: [
      "Up to 1000 compounds per screen (CSV / SDF upload)",
      "Δ-vs-WT selectivity ranking",
      "Promote any hit to a full deep-dock with one click",
    ],
  },
};

export default function FeatureRequestModal({ feature, onClose, onRequested }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state ONLY when the feature (which modal) changes —
  // NOT on every parent re-render. onClose is an inline arrow in the
  // parent, so a naive [feature, onClose] dep re-ran this on the very
  // re-render that onRequested() triggers, wiping `done` back to false
  // and hiding the "Request sent" confirmation. Keyed on [feature] only.
  useEffect(() => {
    setSubmitting(false);
    setDone(false);
    setError(null);
  }, [feature]);

  // Escape-to-close, rebound if the feature or onClose identity changes.
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
  const a = ACCENT[copy.accent];

  async function requestAccess() {
    if (!feature) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.requestFeatureAccess(feature);
      setDone(true);
      onRequested?.(feature, r.access);
    } catch (e: any) {
      setError(e?.message || "Could not send your request. Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feat-gate-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`w-full max-w-lg rounded-lg border ${a.border} bg-slate-950 shadow-2xl`}>
        <div className="flex items-start justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>{copy.emoji}</span>
            <h2 id="feat-gate-title" className={`text-base font-semibold ${a.h2}`}>
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
          {done ? (
            <div className="space-y-3">
              <div className={`inline-flex items-center gap-2 rounded-full ${a.chip} text-xs font-semibold px-3 py-1`}>
                ✓ Request sent
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                Thanks — your request is in. You'll get an email the moment it's
                approved, and this feature will unlock here automatically. No
                need to ask again.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-300 leading-relaxed">{copy.lede}</p>
              <div>
                <div className={`text-[11px] uppercase tracking-[0.18em] ${a.label} mb-2`}>
                  What you get
                </div>
                <ul className="space-y-1.5">
                  {copy.bullets.map((line) => (
                    <li key={line} className="text-sm text-slate-200 flex items-start gap-2">
                      <span className={`${a.check} mt-0.5`}>✓</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="text-xs text-slate-400 bg-slate-900/50 rounded border border-slate-800 px-3 py-2">
                Access is granted per account. Request it and we'll get a ping —
                approvals are usually quick.
              </div>
              {error && (
                <div className="text-xs text-red-300 bg-red-950/40 rounded border border-red-900/50 px-3 py-2">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-800">
          {done ? (
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded ${a.btn} text-white text-xs font-mono uppercase tracking-[0.18em] transition-colors`}
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded text-xs font-mono uppercase tracking-[0.18em] text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={requestAccess}
                disabled={submitting}
                className={`px-4 py-2 rounded ${a.btn} disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-mono uppercase tracking-[0.18em] transition-colors`}
              >
                {submitting ? "Sending…" : "Request access →"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
