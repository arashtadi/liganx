/**
 * Resistance Radar scan history — localStorage-backed log of every
 * resistance scan run in Studio. Lets the user reopen a past scan's
 * liability map without re-docking.
 *
 * Intentionally separate from the Supabase job archive (like the Studio
 * dock-history module): a scan is an assembled view over several docks,
 * and phase 1 keeps it browser-local. Phase 2 can promote these to a
 * durable, shareable backend record. Bounded to MAX_RECENT entries.
 */

const STORAGE_KEY = "liganx-resistance-scans-v1";
const MAX_RECENT = 50;

export interface SavedScanRow {
  code: string;
  label: string;
  significance: string;
  /** Docking score of the mutant, kcal/mol. Null = failed / no pose. */
  mutScore: number | null;
  /** WT score co-docked in the SAME job as this mutant, kcal/mol. */
  wtScore: number | null;
  error?: string | null;
}

export interface SavedResistanceScan {
  /** UUID-ish — for keying React rows. */
  id: string;
  /** ISO timestamp when the scan finished. */
  savedAt: string;
  targetId: string;
  targetLabel: string;
  compoundName: string;
  smiles: string;
  /** WT baseline score, kcal/mol. Null if the WT dock failed. */
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

function newId(): string {
  return `rr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function listResistanceScans(): SavedResistanceScan[] {
  return read().scans.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveResistanceScan(
  scan: Omit<SavedResistanceScan, "id" | "savedAt"> & { savedAt?: string }
): SavedResistanceScan {
  const bucket = read();
  if (bucket.scans.length >= MAX_RECENT) {
    bucket.scans.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
    bucket.scans.splice(0, bucket.scans.length - MAX_RECENT + 1);
  }
  const e: SavedResistanceScan = {
    id: newId(),
    savedAt: scan.savedAt ?? new Date().toISOString(),
    targetId: scan.targetId,
    targetLabel: scan.targetLabel,
    compoundName: scan.compoundName,
    smiles: scan.smiles,
    wtScore: scan.wtScore,
    rows: scan.rows,
  };
  bucket.scans.push(e);
  write(bucket);
  return e;
}

export function deleteResistanceScan(id: string): void {
  const bucket = read();
  bucket.scans = bucket.scans.filter((s) => s.id !== id);
  write(bucket);
}

export function clearResistanceScans(): void {
  write({ scans: [] });
}
