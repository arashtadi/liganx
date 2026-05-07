/**
 * Studio session dock history — localStorage-backed log of every
 * Quick Dock that ran in Studio. Lets users compare runs without
 * re-docking, and click any past run to restore its SMILES + target +
 * mutation back into Studio.
 *
 * The user's permanent job archive lives at /jobs (Supabase-backed)
 * and survives across devices. This module is intentionally separate
 * — Studio runs are research-grade quick experiments, often dozens
 * per session, that don't need to leak into the long-term archive
 * unless explicitly promoted. Bounded to MAX_RECENT entries.
 */

const STORAGE_KEY = "liganx-studio-dock-history";
const MAX_RECENT = 100;

export interface DockHistoryEntry {
  /** UUID-ish — for keying React rows. */
  id: string;
  /** SMILES that was docked. */
  smiles: string;
  /** Compound name if known (loaded from library/PubChem); else "". */
  compoundName?: string;
  /** Target id (catalog), e.g. "egfr". */
  target: string;
  /** "WT" or mutation code, e.g. "T790M". */
  mutation: string;
  /** Vina score in kcal/mol. */
  score: number | null;
  /** Pocket-contact residues from the run. */
  hits: string[];
  /** Wall-clock timestamp (ISO) when the dock returned. */
  ranAt: string;
  /** Whether the pose drifted off-pocket (for the badge). */
  poseInPocket?: boolean;
  /** Estimated Kd from the score, for the row preview. */
  kdLabel?: string;
}

interface Bucket {
  entries: DockHistoryEntry[];
}

function read(): Bucket {
  if (typeof localStorage === "undefined") return { entries: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { entries: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return parsed as Bucket;
  } catch {
    return { entries: [] };
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
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function listDockHistory(): DockHistoryEntry[] {
  return read().entries.slice().sort((a, b) => b.ranAt.localeCompare(a.ranAt));
}

export function appendDockHistory(entry: Omit<DockHistoryEntry, "id" | "ranAt"> & { ranAt?: string }): DockHistoryEntry {
  const bucket = read();
  if (bucket.entries.length >= MAX_RECENT) {
    bucket.entries.sort((a, b) => a.ranAt.localeCompare(b.ranAt));
    bucket.entries.splice(0, bucket.entries.length - MAX_RECENT + 1);
  }
  const e: DockHistoryEntry = {
    id: newId(),
    ranAt: entry.ranAt ?? new Date().toISOString(),
    smiles: entry.smiles,
    compoundName: entry.compoundName,
    target: entry.target,
    mutation: entry.mutation,
    score: entry.score,
    hits: entry.hits,
    poseInPocket: entry.poseInPocket,
    kdLabel: entry.kdLabel,
  };
  bucket.entries.push(e);
  write(bucket);
  return e;
}

export function deleteDockHistoryEntry(id: string): void {
  const bucket = read();
  bucket.entries = bucket.entries.filter((e) => e.id !== id);
  write(bucket);
}

export function clearDockHistory(): void {
  write({ entries: [] });
}
