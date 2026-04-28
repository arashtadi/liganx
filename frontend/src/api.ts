// API client. Hits the dev proxy at /api/* in dev, the deployed backend in prod.

import { supabase } from "./lib/supabase";

const BASE = import.meta.env.VITE_API_URL || "/api";

/** Pull the current Supabase access_token (if any) and return it as an
 *  Authorization header. Read fresh on every request so refreshed tokens
 *  flow through automatically. Returns an empty object when signed out so
 *  public endpoints (catalog, share-link GETs) keep working unauthenticated. */
async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** ADMET / drug-likeness descriptors served alongside each compound.
 *  Computed from SMILES via RDKit on the backend, cached. Null when
 *  RDKit isn't available or the SMILES failed to parse — in that case
 *  the UI renders an em-dash for the compound's chip row. */
export interface Admet {
  mw: number;
  logp: number;
  hba: number;
  hbd: number;
  tpsa: number;
  rot_bonds: number;
  rings: number;
  aromatic_rings: number;
  heavy_atoms: number;
  qed: number | null;
  lipinski_violations: number;
  lipinski_pass: boolean;
  veber_violations: number;
  veber_pass: boolean;
  pains: string[];
  pains_count: number;
}

export interface Compound {
  id: number;
  name: string | null;
  smiles: string;
  admet?: Admet | null;
}

export interface DockingResult {
  compound_id: number;
  variant: string;        // "WT" or e.g. "T790M"
  best_score: number;     // kcal/mol — lower = stronger binding
  pose_uri: string | null;
  extra?: string | null;  // pipe-separated key=value blob; parsed by lib/parseExtra
}

/** Cross-docking sanity check — re-docks the bound co-crystal ligand and
 *  reports heavy-atom RMSD vs the original crystal pose. <2 Å = pocket
 *  geometry is well-behaved (typical for any pocket the ligand was
 *  crystallized in); >4 Å = pocket likely mis-defined or scoring junk.
 *  Cached per (pdb_id, chain), shown as a badge in the JobPage header. */
export interface PdbQuality {
  pdb_id: string;
  chain: string;
  ligand_resname: string;          // e.g. "HYZ", "GFB" — the bound drug
  rmsd_angstroms: number;
  verdict: "valid" | "uncertain" | "questionable";
  smiles: string;
  crystal_atom_count: number;
  docked_atom_count: number;
  timestamp?: string;
}

export interface Job {
  id: number;
  /** Public, unguessable URL identifier. The frontend always navigates by
   *  share_id; the integer `id` is only kept for back-compat with bookmarks
   *  pointing at the legacy `/jobs/47`-style URLs. */
  share_id: string;
  pdb_id: string;
  chain: string;
  uniprot_id: string | null;
  mutations: string[];
  status: JobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  /** Vina-style search depth used for this job. 8 = fast / 16 = balanced /
   *  32 = thorough. Echoed by the backend so the UI can label runs. */
  exhaustiveness: number;
  /** Whether WT was docked alongside the requested mutants. When false the
   *  matrix has no REF column and no Δ values. */
  include_wt: boolean;
  /** Owner — UUID of auth.users(id). Null for legacy/anonymous jobs. The
   *  frontend uses this to decide whether to render the Cancel/Edit Title
   *  buttons (only the owner sees them). */
  user_id: string | null;
  /** User-editable display title. Falls back to a synthesized label
   *  ("EGFR · 4 compounds · T790M+C797S") when null. */
  title: string | null;
  tags: string[];
  compounds: Compound[];
  results: DockingResult[];
  /** Cross-docking sanity check result. Null until the background job
   *  for this (pdb_id, chain) has produced a cached value. */
  pdb_quality?: PdbQuality | null;
}

export interface JobCreatePayload {
  pdb_id: string;
  chain: string;
  uniprot_id?: string | null;
  mutations: string[];
  compounds: { name?: string | null; smiles: string }[];
  /** Optional. Backend defaults to 8 (Vina default). Allowed range 4–64. */
  exhaustiveness?: number;
  /** Optional. Backend defaults to true. Set false to skip the WT row. */
  include_wt?: boolean;
  /** Optional human-readable title shown in the History page. */
  title?: string | null;
  /** Optional tags for grouping in the History page. */
  tags?: string[];
}

/** A single mutation-validation issue surfaced by the /jobs pre-flight check.
 *  See backend `prep.validate_mutations`. The shape is open-ended so we can
 *  evolve issue codes without forcing a frontend release. */
export interface MutationIssue {
  mutation: string;
  code: "residue_not_resolved" | "wildtype_mismatch" | "unparseable" | "chain_empty";
  pdb_id: string;
  chain: string;
  residue: number | null;
  expected_wt?: string;
  actual_wt?: string;
  chain_range?: [number, number] | null;
  message: string;
  /** Other PDB structures of the same UniProt that DO contain this residue.
   *  Populated for `residue_not_resolved` issues when the backend has the
   *  UniProt accession; otherwise omitted. */
  alternatives?: AlternativePdb[];
}

export interface AlternativePdb {
  pdb_id: string;
  chain: string;
  title: string;
  resolution_A: number | null;
}

/** Structured validation failure body returned by the backend on 422. */
export interface ValidationDetail {
  message?: string;
  invalid_compounds?: { index: number; name: string | null; reason: string }[];
  mutation_issues?: MutationIssue[];
}

/** Custom error so callers can branch on HTTP status without parsing strings.
 *  When the response body had a structured `detail` object, it's exposed via
 *  `.detail` so the UI can render rich validation panels (per-mutation
 *  explanations, alternative-PDB suggestions, etc.). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: ValidationDetail | unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(await authHeader()),
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!r.ok) {
    // Prefer the FastAPI `detail` field — that's the human message we wrote.
    let detail: string | undefined;
    let detailObj: unknown;
    try {
      const body = await r.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (body?.detail) {
        // Keep the raw object available on the error so callers can render
        // structured panels (e.g. mutation_issues with alternatives).
        detailObj = body.detail;
        // For the message string, prefer a human-readable summary if present;
        // otherwise stringify so plain logging still yields something useful.
        if (typeof body.detail.message === "string") detail = body.detail.message;
        else detail = JSON.stringify(body.detail);
      }
    } catch {
      // body wasn't JSON
    }
    throw new ApiError(r.status, detail || `${r.status} ${r.statusText}`, detailObj);
  }
  return r.json();
}

export interface PocketBox {
  center: [number, number, number];
  size: [number, number, number];
}
export interface CatalogMutation {
  code: string;
  label: string;
  significance: string;
}
export interface CatalogCompound {
  name: string;
  smiles: string;
  mechanism: string;
}
export interface CatalogTarget {
  id: string;
  name: string;
  uniprot: string;
  pdb_id: string;
  chain: string;
  pocket: PocketBox;
  description: string;
  indications: string[];
  mutations: CatalogMutation[];
  compounds: CatalogCompound[];
}

export const api = {
  health: () => request<{ status: string; version: string; env: string }>("/health"),
  createJob: (payload: JobCreatePayload) =>
    request<Job>("/jobs", { method: "POST", body: JSON.stringify(payload) }),
  // `key` is the share_id (preferred) or legacy integer ID; backend resolves
  // either form. Typed as `string | number` so callers can pass whichever
  // they have on hand without a manual coerce.
  getJob: (key: string | number) => request<Job>(`/jobs/${key}`),
  cancelJob: (key: string | number) =>
    request<Job>(`/jobs/${key}/cancel`, { method: "POST" }),
  /** Permanently delete a job and all its compounds/results. Owner-only;
   *  the backend returns 404 for non-owners (doesn't reveal existence).
   *  Returns void (the endpoint is 204 No Content on success). */
  deleteJob: async (key: string | number): Promise<void> => {
    const r = await fetch(`${BASE}/jobs/${key}`, {
      method: "DELETE",
      headers: { ...(await authHeader()) },
    });
    if (!r.ok && r.status !== 204) {
      let detail: string | undefined;
      try { detail = (await r.json())?.detail; } catch { /* */ }
      throw new ApiError(r.status, detail || `${r.status} ${r.statusText}`);
    }
  },
  listJobs: () => request<Job[]>("/jobs"),
  catalog: () => request<CatalogTarget[]>("/catalog"),
  target: (id: string) => request<CatalogTarget>(`/catalog/${id}`),
  lookupCompound: (q: string) =>
    request<{ name: string; cid: number; smiles: string; iupac_name?: string; molecular_formula?: string }>(
      `/lookup/compound?q=${encodeURIComponent(q)}`,
    ),
  /** Look up basic PDB metadata (title, protein name, organism, UniProt) so
   *  the JobPage header can show "2WGJ · Hepatocyte growth factor receptor"
   *  instead of the bare RCSB code. Backend caches for 24h, so repeat calls
   *  for the same PDB cost ~0ms. Returns at minimum `{pdb_id}` — the rest
   *  may be missing for user uploads or when RCSB is unreachable. */
  pdbInfo: (pdbId: string) =>
    request<{ pdb_id: string; title?: string; protein?: string; organism?: string; uniprot_id?: string; resolution_A?: number | null }>(
      `/lookup/pdb/${encodeURIComponent(pdbId)}/info`,
    ),
  suggestCompound: (q: string) =>
    request<{ query: string; suggestions: string[] }>(
      `/lookup/compound/suggest?q=${encodeURIComponent(q)}`,
    ),
  suggestPdb: (q: string) =>
    request<{ query: string; suggestions: { pdb_id: string; title: string }[] }>(
      `/suggest/pdb?q=${encodeURIComponent(q)}`,
    ),
  suggestMutations: (q: string, gene?: string | null, uniprotId?: string | null) => {
    const params = new URLSearchParams({ q });
    if (gene) params.set("gene", gene);
    if (uniprotId) params.set("uniprot_id", uniprotId);
    return request<{
      query: string; gene: string | null; uniprot_id: string | null;
      suggestions: { code: string; gene: string; note: string; source?: "curated" | "uniprot" | "cbioportal" }[];
    }>(`/suggest/mutations?${params.toString()}`);
  },
  parseCompoundsFile: async (file: File): Promise<{ compounds: { name: string; smiles: string }[]; truncated: boolean; limit?: number }> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${BASE}/lookup/compounds/parse`, { method: "POST", body: fd });
    if (!r.ok) {
      let detail: string | undefined;
      try { detail = (await r.json())?.detail; } catch { /* */ }
      throw new ApiError(r.status, detail || `${r.status} ${r.statusText}`);
    }
    return r.json();
  },
  /** Upload a user-supplied PDB file (AlphaFold model, in-house crystal,
   *  predicted complex, etc.). Returns a synthetic pdb_id of the form
   *  `USR_<8 hex>` plus the chain IDs we found in the file so the UI can
   *  populate the chain selector without making the user guess. */
  uploadPdb: async (file: File): Promise<{ pdb_id: string; chains: string[]; size_bytes: number }> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${BASE}/lookup/pdb/upload`, { method: "POST", body: fd });
    if (!r.ok) {
      let detail: string | undefined;
      try { detail = (await r.json())?.detail; } catch { /* */ }
      throw new ApiError(r.status, detail || `${r.status} ${r.statusText}`);
    }
    return r.json();
  },
  structure: async (pdbId: string, chain: string, variant: string): Promise<string> => {
    // encode the variant — "T790M+C797S" needs the "+" escaped or it becomes a space
    const v = encodeURIComponent(variant);
    const r = await fetch(`${BASE}/structures/${pdbId}/${chain}/${v}`);
    if (!r.ok) throw new Error(`Structure ${pdbId}/${chain}/${variant}: HTTP ${r.status}`);
    return r.text();
  },
  // jobKey is the share_id (preferred) or legacy integer ID — backend resolves
  // both. We accept either type so callers don't have to coerce.
  pose: async (jobKey: string | number, compoundId: number, variant: string): Promise<string> => {
    const v = encodeURIComponent(variant);
    const r = await fetch(`${BASE}/jobs/${jobKey}/poses/${compoundId}/${v}`);
    if (!r.ok) throw new Error(`Pose ${jobKey}/${compoundId}/${variant}: HTTP ${r.status}`);
    return r.text();
  },
};
