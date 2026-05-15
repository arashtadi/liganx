/**
 * Shared Studio types — pulled out of StudioPage.tsx so extracted components
 * (e.g. ProductionViewer3D) can import the same type without circular
 * imports back into the page module.
 */

export interface QuickDockResult {
  ok: boolean;
  score?: number;
  hits?: string[];
  misses?: string[];
  pose_pdbqt_b64?: string;
  pdb_id?: string;
  chain?: string;
  error?: string;
  receptor_variant?: "mutant" | "wt";
  mutation_caveat?: string;
  pose_in_pocket?: boolean;
  pose_offset_a?: number;
  dock_attempts?: number;
  // (v1.27) The SMILES this pose was actually computed from. Stamped at
  // every setDockResult site so the 3D viewer can deterministically tell
  // "is the current 2D structure still the one this pose belongs to?" —
  // instead of inferring it from a timing-sensitive ref that raced with
  // loadIntoCanvas on history-restore / edit-compound.
  smiles?: string;
}
