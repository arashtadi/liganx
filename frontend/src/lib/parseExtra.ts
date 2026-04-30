/**
 * Parse the pipe-separated `extra` field on each docking result into a typed object.
 *
 * The backend writes strings like:
 *
 *   foldx_ddg=-0.66|confidence=medium|posebusters=failed: inchi_convertible,no_radicals|
 *   contacts=LYS745:Hydr,MET793:HBAc|summary=Medium-confidence pose. Key contacts: ...
 *
 * Phase B will give validation its own database columns; until then we live with
 * this string format. Parsing is defensive — unknown keys are ignored, missing
 * keys give undefined.
 */
export interface ParsedExtra {
  /** PoseBusters verdict mapped to a 5-state UX category:
   *   high   — every check passed (green "Passed" ribbon)
   *   medium — 1–2 checks failed, often format quirks (amber "Caution" ribbon)
   *   low    — 3+ checks failed (rose "Suspect" ribbon)
   *   skipped — the check timed out or was bypassed by the runner. NOT a
   *      failure: the pose itself is fine; we just don't have a verdict.
   *      Rendered as a slate "Skipped" ribbon so users don't conflate this
   *      with "validation failed" or with cells where PB never ran at all.
   *   unknown — PoseBusters didn't run on this pose at all (older job, or
   *      validation pipeline crashed entirely). Renders as "Unchecked".
   *
   * The "skipped" state is derived: the backend writes
   *   posebusters=check_skipped: <reason>
   * and we promote that here so the UI doesn't have to grep the string. */
  confidence?: "high" | "medium" | "low" | "skipped" | "unknown";
  poseBusters?: string;
  foldxDDG?: number;
  contacts?: { residue: string; type: string; distance?: number }[];
  /** When ProLIF ran but produced no interactions (or errored), the backend
   *  emits `prolif=empty` or `prolif=err:...`. UI can use this to show "no
   *  detectable interactions" instead of silently hiding the contacts panel. */
  prolifStatus?: string;
  summary?: string;
  /** Which docking engine produced this result. "local" = on-prem Vina;
   *  "runpod" = remote serverless worker; "local_after_runpod_fail" = RunPod
   *  was tried but errored, fell back to local. Useful for billing/telemetry. */
  engine?: string;
  /** Set when the runner couldn't produce a real score for this cell. The
   *  best_score in the DB is 0.0 (a placeholder), NOT a real docking result —
   *  the matrix should render this as "Failed" instead of "−0.00".
   *
   *  - `ligand_prep`: SMILES couldn't be turned into a 3D PDBQT (parse failure,
   *    embedding failure, Meeko crash, etc.). Often unsalvageable input data.
   *  - `docking`: ligand prepped fine, but Vina/QuickVina-GPU itself errored
   *    (rare — usually means the box is malformed or the receptor is broken).
   *  - `mutant_build`: PDBFixer couldn't introduce the requested point mutation
   *    — typically because the residue number/chain doesn't exist in the PDB
   *    (e.g. user typed C481S but selected a non-BTK structure). The runner
   *    currently falls back to docking against the WT receptor, so any raw
   *    score matches WT byte-for-byte; rendering that as a "real" mutant
   *    score is misleading. Show "Mutation build failed" instead.
   *  - `other`: anything else the runner explicitly recorded as a failure. */
  failure?: { kind: "ligand_prep" | "docking" | "mutant_build" | "other"; reason: string };
  /** Conformational strain of the docked pose. Backend writes
   *  `strain=<verdict>:<kcal>` where verdict ∈ {ok, mild, high} and kcal is
   *  the MMFF94s energy difference between the docked geometry and the
   *  lowest relaxed conformer of the same SMILES. >7 kcal/mol typically
   *  flags a Vina junk pose where the ligand is bent unphysically to fit. */
  strain?: { verdict: "ok" | "mild" | "high"; kcal: number };
  /** Smina/Vinardo refined score (kcal/mol). A second-pass scoring of the
   *  Vina pose using a tuned function that discriminates close analogs
   *  better than raw Vina. Same sign convention as Vina (lower = stronger).
   *  When present, the matrix shows it as a small subtitle under the
   *  primary Vina score; PoseDetail surfaces it as a top-level Metric. */
  vinardo?: number;
  /** Phase 0 crystallographic-water displacement counts (#103). The runner
   *  writes `water=N/M` where N is the number of pose-displaced waters and
   *  M is the count of crystallographic waters within the pocket sphere
   *  (8 Å of pocket centre by default).
   *
   *  Honest framing: this is NOT WaterMap. It is geometric overlap with
   *  deposited PDB waters; high B-factor waters are unreliable; mutant
   *  pockets may have de novo waters this method doesn't see. The PoseDetail
   *  panel surfaces this with the explicit Phase 0 caveat copy. */
  water?: { displaced: number; pocketCount: number };
  /** Boltz-2 affinity head 1 — log10(IC50 in μM). More-negative = stronger
   *  binder. NOT a kcal/mol free-energy value; do NOT compare numerically
   *  with Vina/GNINA scores. The matrix Δ math (mutant - WT) is still
   *  meaningful as a direction signal. Present only on cells with
   *  engine=boltz2. */
  affValue?: number;
  /** Boltz-2 affinity head 2 — model's probability that this ligand is a
   *  real binder vs decoy (0..1). Hit-triage signal; useful as a
   *  secondary confidence indicator. Present only on cells with
   *  engine=boltz2. */
  affProb?: number;
  /** Number of residues passed to Boltz-2 as the pocket constraint
   *  (CA atoms within the docking box). Empty constraint = Boltz-2's
   *  learned pocket prior decided where to bind. Present only on
   *  cells with engine=boltz2. */
  pocketResidues?: number;
  /** When the mutation residue lies outside the Vina docking box (typically
   *  >11 Å from box center), single-conformation docking can't capture the
   *  geometric effect of the substitution — the mutated atoms are simply
   *  outside Vina's search space. The cell will reproducibly show the same
   *  Vina score as WT, NOT because the platform is broken but because
   *  docking-as-a-method has this fundamental limitation. The matrix UI
   *  surfaces this as an "outside pocket" badge so the user knows to
   *  interpret a zero delta as "method can't tell" rather than
   *  "mutation has no effect". The number is the CA-to-pocket-center
   *  distance in Å. */
  outsidePocketA?: number;
  raw: string;
}

export function parseExtra(extra: string | null | undefined): ParsedExtra {
  if (!extra) return { raw: "" };
  const out: ParsedExtra = { raw: extra };

  // Failure markers don't follow the key=value format — the runner writes them
  // as bare prefixes like "ligand_prep_failed: <reason>" or
  // "mutant_build_failed:MutateError:Residue ... not found ...|engine=...".
  // Detect them up front so the UI knows the row's score is a placeholder,
  // not a real docking. Trailing `|key=value` fields (engine, vinardo, etc.)
  // are allowed after the failure prefix — the runner sometimes attaches
  // those alongside even when the row is fundamentally a failure.
  const failureMatch = extra.match(
    /^(ligand_prep_failed|docking_failed|mutant_build_failed):([^|]*)/,
  );
  if (failureMatch) {
    const tag = failureMatch[1];
    const kind: "ligand_prep" | "docking" | "mutant_build" =
      tag === "ligand_prep_failed" ? "ligand_prep"
        : tag === "docking_failed" ? "docking"
          : "mutant_build";
    out.failure = { kind, reason: failureMatch[2].trim() };
    // Don't `return` early for mutant_build_failed — the runner may have
    // attached useful side-info (engine, vinardo from the WT-fallback dock,
    // contacts) that we still want available for the PoseDetail drawer.
    // For ligand_prep / docking the remainder is meaningless, so bail.
    if (kind !== "mutant_build") return out;
  }

  for (const part of extra.split("|")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    switch (k) {
      case "confidence":
        if (v === "high" || v === "medium" || v === "low" || v === "unknown") {
          out.confidence = v;
        }
        break;
      case "posebusters":
        out.poseBusters = v;
        break;
      case "foldx_ddg": {
        const f = parseFloat(v);
        if (!Number.isNaN(f)) out.foldxDDG = f;
        break;
      }
      case "contacts":
        // Backwards-compatible: 2-field "RES:Type" or 3-field "RES:Type:Å"
        // The third field, when present, is the closest atom-pair distance
        // in Å (single decimal). Older rows without distance still parse fine.
        out.contacts = v.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const [residue, type, dStr] = s.split(":");
            const d = dStr !== undefined ? parseFloat(dStr) : NaN;
            return {
              residue: residue ?? s,
              type: type ?? "",
              distance: Number.isFinite(d) ? d : undefined,
            };
          });
        break;
      case "summary":
        out.summary = v;
        break;
      case "prolif":
        out.prolifStatus = v;
        break;
      case "engine":
        out.engine = v;
        break;
      case "vinardo": {
        const n = parseFloat(v);
        if (Number.isFinite(n)) out.vinardo = n;
        break;
      }
      case "strain": {
        // Format: `<verdict>:<kcal>` — e.g. "ok:1.2", "mild:5.4", "high:9.1"
        const [verdict, kStr] = v.split(":");
        const k = parseFloat(kStr);
        if ((verdict === "ok" || verdict === "mild" || verdict === "high") && Number.isFinite(k)) {
          out.strain = { verdict: verdict as "ok" | "mild" | "high", kcal: k };
        }
        break;
      }
      case "water": {
        // Format: "<displaced>/<pocketCount>" — both non-negative integers.
        const m = v.match(/^(\d+)\/(\d+)$/);
        if (m) {
          out.water = {
            displaced: parseInt(m[1], 10),
            pocketCount: parseInt(m[2], 10),
          };
        }
        break;
      }
      case "aff_value": {
        const n = parseFloat(v);
        if (Number.isFinite(n)) out.affValue = n;
        break;
      }
      case "aff_prob": {
        const n = parseFloat(v);
        if (Number.isFinite(n)) out.affProb = n;
        break;
      }
      case "pocket_residues": {
        const n = parseInt(v, 10);
        if (Number.isFinite(n)) out.pocketResidues = n;
        break;
      }
      case "mutation_outside_pocket": {
        // Format: "12.3A" — distance from CA to pocket center
        const m = v.match(/^([\d.]+)A?$/);
        const dist = m ? parseFloat(m[1]) : NaN;
        if (Number.isFinite(dist)) out.outsidePocketA = dist;
        break;
      }
      // ignore err, validate_err, foldx_failed prefixes etc.
    }
  }

  // Promote PoseBusters timeouts / explicit skips into a derived "skipped"
  // confidence so the UI can render a distinct slate badge instead of
  // collapsing to "Unchecked" (which reads as "validation failed" to users
  // scanning the matrix). The backend writes one of:
  //   posebusters=check_skipped: timeout
  //   posebusters=check_skipped: <other reason>
  //   posebusters=passed all 0 checks   ← PB couldn't even start, treat as skipped
  // Only override when the backend left confidence at "unknown" / undefined —
  // if it explicitly wrote high/medium/low we trust that.
  if (
    (out.confidence === "unknown" || out.confidence === undefined) &&
    out.poseBusters &&
    (/check_skipped/i.test(out.poseBusters) || /passed all 0 checks/i.test(out.poseBusters))
  ) {
    out.confidence = "skipped";
  }

  return out;
}
