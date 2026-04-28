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
  confidence?: "high" | "medium" | "low" | "unknown";
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
   *  - `other`: anything else the runner explicitly recorded as a failure. */
  failure?: { kind: "ligand_prep" | "docking" | "other"; reason: string };
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
  // as bare prefixes like "ligand_prep_failed: <reason>". Detect them up front
  // so the UI knows the row's score is a placeholder, not a real docking.
  const failureMatch = extra.match(/^(ligand_prep_failed|docking_failed):\s*(.*)$/);
  if (failureMatch) {
    const kind = failureMatch[1] === "ligand_prep_failed" ? "ligand_prep" : "docking";
    out.failure = { kind, reason: failureMatch[2].trim() };
    return out;
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
      case "foldx_ddg":
        const f = parseFloat(v);
        if (!Number.isNaN(f)) out.foldxDDG = f;
        break;
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
          out.strain = { verdict, kcal: k };
        }
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
  return out;
}
