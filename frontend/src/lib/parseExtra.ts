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
      // ignore err, validate_err, foldx_failed prefixes etc.
    }
  }
  return out;
}
