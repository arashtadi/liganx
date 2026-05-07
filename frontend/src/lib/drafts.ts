/**
 * Studio drafts — localStorage-backed autosave bucket.
 *
 * Why this exists: classic save/name dialogs are how users lose work.
 * The user starts editing a compound, the modal asks "name this?", they
 * dismiss the modal because they're not done yet, then a refresh / nav
 * away nukes the SMILES. We've shipped four bug fixes against this
 * class of issue (see tasks #14, #24, #25, #49) and the underlying UX
 * model never stops biting back.
 *
 * Solution: decouple SAVING from NAMING. Every SMILES change is silently
 * persisted to this drafts bucket with an auto-generated name. Naming
 * happens later, only when the user explicitly clicks "Promote to
 * library". The user simply cannot lose a compound — every state they
 * touched is already on disk.
 *
 * Storage: localStorage under `liganx-studio-drafts` as JSON. Bounded
 * to MAX_DRAFTS most recent entries; older drafts auto-evicted on
 * insert. SMILES strings are tiny so even 100 drafts is < 50 KB.
 *
 * Future: when we wire up a Supabase `studio_drafts` table for
 * cross-device sync, this module's public API stays the same — only
 * the storage backend swaps. Keep the interface boring.
 */

const STORAGE_KEY = "liganx-studio-drafts";
const MAX_DRAFTS = 50;

export interface StudioDraft {
  /** UUID-ish — stable identifier across edits. */
  id: string;
  /** SMILES string (canonical or whatever Ketcher emitted). */
  smiles: string;
  /** Catalog target id (e.g. "egfr") if one was selected. */
  target?: string;
  /** Mutation code (e.g. "T790M") or "WT". */
  mutation?: string;
  /** User-chosen name. Empty until the user promotes the draft. */
  name?: string;
  /** ISO timestamps. updatedAt drives the "saved Xs ago" indicator. */
  createdAt: string;
  updatedAt: string;
}

interface Bucket {
  drafts: StudioDraft[];
}

function readBucket(): Bucket {
  if (typeof localStorage === "undefined") return { drafts: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { drafts: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.drafts)) return { drafts: [] };
    return parsed as Bucket;
  } catch {
    // Corrupt JSON — wipe and start fresh rather than crash. This is
    // localStorage; the cost of resetting is acceptable.
    return { drafts: [] };
  }
}

function writeBucket(b: Bucket): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    // Quota exceeded or private mode — silently no-op. The user
    // won't get drafts persisted but the UI won't crash either.
  }
}

/** Generate a short auto-name like "untitled · 2026-05-06 14:23". */
export function autoName(now: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `untitled · ${date} ${time}`;
}

/** Tiny ID generator — collision risk is negligible for 50-draft buckets. */
function newId(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** List all drafts, newest first. Used by the drafts panel (v0.31+). */
export function listDrafts(): StudioDraft[] {
  return readBucket().drafts.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Look up a single draft by id. Returns null if not found. */
export function getDraft(id: string): StudioDraft | null {
  return readBucket().drafts.find((d) => d.id === id) || null;
}

/**
 * Create or update a draft. If `id` is provided and exists, the matching
 * draft is updated in place (smiles/target/mutation/updatedAt). Otherwise
 * a new draft is inserted with an auto-name and the bucket is trimmed
 * to MAX_DRAFTS most recent.
 *
 * Returns the upserted draft (with its id) so callers can hold the id
 * in state and keep updating the same record.
 */
export function upsertDraft(
  partial: { smiles: string; target?: string; mutation?: string; name?: string },
  id?: string,
): StudioDraft {
  const bucket = readBucket();
  const now = new Date().toISOString();
  if (id) {
    const idx = bucket.drafts.findIndex((d) => d.id === id);
    if (idx >= 0) {
      const updated: StudioDraft = {
        ...bucket.drafts[idx],
        smiles: partial.smiles,
        target: partial.target,
        mutation: partial.mutation,
        name: partial.name ?? bucket.drafts[idx].name,
        updatedAt: now,
      };
      bucket.drafts[idx] = updated;
      writeBucket(bucket);
      return updated;
    }
  }
  // New draft. Trim oldest entries if we're at cap.
  if (bucket.drafts.length >= MAX_DRAFTS) {
    bucket.drafts.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    bucket.drafts.splice(0, bucket.drafts.length - MAX_DRAFTS + 1);
  }
  const draft: StudioDraft = {
    id: newId(),
    smiles: partial.smiles,
    target: partial.target,
    mutation: partial.mutation,
    name: partial.name ?? autoName(),
    createdAt: now,
    updatedAt: now,
  };
  bucket.drafts.push(draft);
  writeBucket(bucket);
  return draft;
}

/** Delete a draft. Used by the drafts panel and the "promote" flow
 *  (which moves a draft to the permanent library, then removes it here). */
export function deleteDraft(id: string): void {
  const bucket = readBucket();
  bucket.drafts = bucket.drafts.filter((d) => d.id !== id);
  writeBucket(bucket);
}
