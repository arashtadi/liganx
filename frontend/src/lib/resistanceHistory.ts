/**
 * Resistance Radar scan history — localStorage-backed log of every
 * resistance scan run in Studio.
 *
 * Scans are persisted the moment docking is SUBMITTED (status "running"),
 * carrying each mutation's job id, so a scan survives the user closing the
 * window mid-run: reopening it resumes polling the same jobs (which keep
 * running server-side) and fills the map in. Finished scans reopen instantly
 * with no re-docking.
 *
 * Intentionally separate from the Supabase job archive: a scan is an
 * assembled view over several docks, and phase 1 keeps it browser-local.
 * Phase 2 can promote these to a durable, shareable backend record. Bounded
 * to MAX_RECENT entries.
 */

const STORAGE_KEY = "liganx-resistance-scans-v1";
const MAX_RECENT = 50;

export interface SavedScanRow {
  code: string;
  label: string;
  significance: string;
  /** Docking score of the mutant, kcal/mol. Null = not yet done / failed. */
  mutScore: number | null;
  /** WT score co-docked in the SAME job as this mutant, kcal/mol. */
  wtScore: number | null;
  /** Job that docked this mutant — for the pose link and for resume. */
  jobKey?: string | null;
  error?: string | null;
  // ── Phase 2: calibrated 2-signal (Δ + ESM2) forecast, filled once the
  // dock's Δ is scored via /calibrate/score. Absent on phase-1 records. ──
  /** Calibrated probability that this mutation confers resistance (0–1). */
  prob?: number | null;
  /** Where ESM2 came from: cached_esm2 | live_esm2_pod | blosum_proxy | … */
  probSource?: string | null;
  /** Model verdict: high_confidence_resistance | borderline_resistance | low_probability_resistance */
  probVerdict?: string | null;
}

export interface SavedResistanceScan {
  /** UUID-ish — for keying React rows and upserting in place. */
  id: string;
  /** ISO timestamp when the scan was first created (docking submitted). */
  savedAt: string;
  /** ISO timestamp of the last update. */
  updatedAt: string;
  /** "running" = docks still in flight (resume on reopen); "done" = final. */
  status: "running" | "done";
  targetId: string;
  targetLabel: string;
  compoundName: string;
  smiles: string;
  /** Representative (mean) WT baseline across batches, kcal/mol. */
  wtScore: number | null;
  rows: SavedScanRow[];
}

interface Bucket {
  scans: SavedResistanceScan[];
}

function read(): Bucket {
  if (typeof localStorage === "undefined") return { scans: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { scans: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.scans)) return { scans: [] };
    return parsed as Bucket;
  } catch {
    return { scans: [] };
  }
}

function write(b: Bucket): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    // quota / private mode — silently no-op.
  }
}

export function newScanId(): string {
  return `rr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function listResistanceScans(): SavedResistanceScan[] {
  return read().scans.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function getResistanceScan(id: string): SavedResistanceScan | null {
  return read().scans.find((s) => s.id === id) ?? null;
}

/** Create the scan if new, or replace it in place when the id already exists.
 *  Used both to save a fresh submit and to update a running scan as docks
 *  land. Backward-compatible with older records that lack status/jobKey. */
export function upsertResistanceScan(scan: SavedResistanceScan): void {
  const bucket = read();
  const idx = bucket.scans.findIndex((s) => s.id === scan.id);
  if (idx >= 0) {
    bucket.scans[idx] = scan;
  } else {
    if (bucket.scans.length >= MAX_RECENT) {
      bucket.scans.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
      bucket.scans.splice(0, bucket.scans.length - MAX_RECENT + 1);
    }
    bucket.scans.push(scan);
  }
  write(bucket);
}

export function deleteResistanceScan(id: string): void {
  const bucket = read();
  bucket.scans = bucket.scans.filter((s) => s.id !== id);
  write(bucket);
}

export function clearResistanceScans(): void {
  write({ scans: [] });
}
