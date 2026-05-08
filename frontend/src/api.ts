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
  /** Docking engine that the runner used for this job. Same set as
   *  JobCreatePayload.engine. Null on very old rows that predate the
   *  column being added (legacy = quickvina2_gpu). The progress bar
   *  uses this to pick engine-appropriate pre-flight stages — Vina
   *  has more (receptor PDBQT prep, FoldX mutants), Boltz-2 has
   *  fewer (sequence extraction, no PDBQT). */
  engine?: "quickvina2_gpu" | "gnina" | "boltz2" | string | null;
  /** Live-updated stage slug the runner writes as it advances through
   *  pre-flight + docking phases. The progress banner translates the
   *  slug into a friendly label ('cleaning_pdb' → 'Cleaning structure
   *  with PDBFixer', 'docking_3_of_8' → 'Docking 3 of 8', etc.). NULL
   *  when the job hasn't started or has terminated. Slugs we currently
   *  emit: fetching_pdb, cleaning_pdb, preparing_receptor,
   *  building_mutant_<MUT>, preparing_compounds, extracting_sequence,
   *  predicting_<i>_of_<n>, validating_poses. */
  stage?: string | null;
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
  /** Optional. Docking engine. Three options:
   *  "quickvina2_gpu" (default): QuickVina2-GPU on the Pod, Vina-family physics-empirical.
   *  "gnina": Vina-fork with CNN pose rescoring. Backend silently falls back
   *           to quickvina2_gpu when GNINA_ENABLED is off, so always safe to send.
   *  "boltz2": MIT/Recursion Boltz-2 ML pose+affinity model. REJECTED at submit
   *           with a 503 if BOLTZ2_ENABLED is off — methodology is too different
   *           to silently fall back. See runpod/BOLTZ2_INSTALL.md for pod-side install. */
  engine?: "quickvina2_gpu" | "gnina" | "boltz2";
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
  invalid_compounds?: {
    index: number;
    name: string | null;
    reason: string;
    /** New fields surfaced by the upgraded eager validator. */
    smiles?: string;
    /** Why this row failed — one of:
     *  - "empty"      — no SMILES typed
     *  - "too_long"   — over 1000 chars
     *  - "parse"      — RDKit refused to parse it
     *  - "fragments"  — disconnected pieces (largest_fragment provided)
     *  - "embed"      — parsed fine but no 3D conformer (would fail at
     *                   ligand prep — caught here instead). */
    kind?: "empty" | "too_long" | "parse" | "fragments" | "embed";
    fragment_count?: number;
    largest_fragment?: string;
  }[];
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
    // Defense-in-depth: if the backend rejects with 403 + the
    // profile-incomplete prefix, hard-redirect to /welcome. This catches
    // the corner case where the frontend ProfileRedirect didn't fire
    // (e.g. user opened a deep link directly) but the user still tried
    // a write operation. Using window.location.href forces a fresh load
    // so ProfileRedirect re-mounts cleanly with the right user.
    if (
      r.status === 403 &&
      typeof detail === "string" &&
      detail.startsWith("Please complete your profile") &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/welcome"
    ) {
      window.location.href = "/welcome";
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

/** Typed current-user profile, returned by GET /me/profile and echoed
 *  by PUT. Mirrors Supabase user_metadata into a SQL-queryable shape.
 *  All fields except user_id and marketing_opt_in can be null because
 *  OAuth users sign up without filling in the profile form. */
export interface UserProfile {
  user_id: string;
  full_name?: string | null;
  organization?: string | null;
  role?: string | null;
  /** Free-form description of the user's role when role === 'other'.
   *  NULL when role is one of the canonical enum values. */
  role_other?: string | null;
  researchgate_url?: string | null;
  marketing_opt_in: boolean;
  signup_source?: string | null;
}

/** PATCH-style payload for PUT /me/profile. All fields optional —
 *  only the ones present in the request are updated. Empty string
 *  clears the field. */
export interface UserProfileUpdate {
  full_name?: string;
  organization?: string;
  role?: string;
  role_other?: string;
  researchgate_url?: string;
  marketing_opt_in?: boolean;
}

/** One entry in a saved compound's AI suggestion history. The Ketcher
 *  modal's AI sidebar appends to this on every successful response so
 *  re-opening the compound days later restores the conversation.
 *  Capped at 10 entries server-side; starred entries protected from
 *  auto-prune. Mirrors backend AIHistoryEntry. */
export interface AIHistoryEntry {
  /** ULID/UUID generated client-side. Stable across edits so React keys
   *  don't shift when the array re-orders. */
  id: string;
  /** ISO 8601 timestamp of when the response was received. */
  ts: string;
  /** The user's prompt — what they asked the AI to do. */
  instruction: string;
  /** The SMILES the AI suggested. */
  smiles: string;
  /** One-sentence rationale from the AI. */
  rationale: string;
  /** Any caveats the AI surfaced (chirality, drug-likeness, etc.). */
  warnings: string[];
  /** User-applied flag. "star" protects from auto-prune; "reject" is a
   *  visual marker but doesn't change retention. */
  flag?: "star" | "reject" | null;
}

/** A saved compound in the user's library. Auto-saves from the New-job
 *  form when both name and SMILES are present. Backend upserts on
 *  (user_id, name) so editing a name's SMILES updates rather than
 *  duplicates. Tags are managed separately via the /tags endpoint —
 *  upserts never touch them. */
export interface UserCompound {
  id: number;
  name: string;
  smiles: string;
  tags: string[];
  /** AI sidebar conversation history. Empty array for compounds saved
   *  before the feature shipped (server default: '[]'::jsonb). */
  ai_history?: AIHistoryEntry[];
  created_at: string;
  updated_at: string;
}

/** One row in the admin /users list. Mirrors backend AdminUserRow. */
export interface AdminUserRow {
  user_id: string;
  email: string;
  full_name: string | null;
  organization: string | null;
  role: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  job_quota: number;
  jobs_used: number;
  jobs_total: number;
  is_admin: boolean;
}

export const api = {
  health: () => request<{ status: string; version: string; env: string }>("/health"),

  // ── Current-user profile (typed mirror of Supabase user_metadata) ──
  // Reads from public.user_profile via the backend so we get clean
  // typed columns instead of squinting at session.user.user_metadata.
  // PUT is PATCH-style — only fields you include are touched. Empty
  // string clears a column (so user can blank out their org if they
  // want).
  getMyProfile: () => request<UserProfile>("/me/profile"),
  updateMyProfile: (patch: UserProfileUpdate) =>
    request<UserProfile>("/me/profile", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  /** Mark the OAuth complete-profile modal as dismissed. Persists
   *  across browsers/devices because it lives on the user_profile
   *  row rather than localStorage. Idempotent — calling twice is fine. */
  dismissOnboarding: async (): Promise<void> => {
    const r = await fetch(`${BASE}/me/profile/dismiss-onboarding`, {
      method: "POST",
      headers: { ...(await authHeader()) },
    });
    if (!r.ok && r.status !== 204) {
      throw new ApiError(r.status, `${r.status} ${r.statusText}`);
    }
  },

  // ── Saved compound library (per-user) ──────────────────────────────
  // Auto-saves from the New-job form when both name and SMILES are
  // filled. Backed by public.user_compound. Upsert is by name, so
  // re-saving "Aspirin" with a new SMILES updates the existing row.
  getMyCompounds: () => request<UserCompound[]>("/me/compounds"),
  saveMyCompound: (payload: { name: string; smiles: string }) =>
    request<UserCompound>("/me/compounds", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteMyCompound: async (id: number): Promise<void> => {
    const r = await fetch(`${BASE}/me/compounds/${id}`, {
      method: "DELETE",
      headers: { ...(await authHeader()) },
    });
    if (!r.ok && r.status !== 204) {
      throw new ApiError(r.status, `${r.status} ${r.statusText}`);
    }
  },
  /** Replace the tag set on a saved compound. Backend overwrites the whole
   *  list (same shape as the History job-tags endpoint), so callers send the
   *  full desired tag array — not a diff. Server trims, dedupes, and length-
   *  bounds each tag. */
  saveMyCompoundTags: (id: number, tags: string[]) =>
    request<UserCompound>(`/me/compounds/${id}/tags`, {
      method: "PATCH",
      body: JSON.stringify({ tags }),
    }),
  /** Replace the AI suggestion history on a saved compound. Same
   *  replace-the-whole-list shape as tags — frontend manages the array
   *  (append on response, delete per entry, flag toggle) and PUTs the
   *  canonical version. Server caps at 10 entries (starred protected). */
  saveMyCompoundAIHistory: (id: number, ai_history: AIHistoryEntry[]) =>
    request<UserCompound>(`/me/compounds/${id}/ai-history`, {
      method: "PATCH",
      body: JSON.stringify({ ai_history }),
    }),

  /** Inline SMILES inspection — parse + 2D depiction + fragment detection,
   *  plus optional 3D-embed sanity check. Backs the MoleculePreview that
   *  sits on every compound row in Step 3 of the New-job form. Frontend
   *  debounces calls at ~400ms with embed_check=false; submit-time uses
   *  embed_check=true to catch the runtime ligand-prep failure mode at
   *  the form level instead of after a wasted GPU run. */
  inspectSmiles: (payload: { smiles: string; embed_check?: boolean; width?: number; height?: number }) =>
    request<{
      valid: boolean;
      error: string | null;
      canonical_smiles: string | null;
      svg: string | null;
      fragment_count: number;
      largest_fragment: { smiles: string; atom_count: number } | null;
      embed_ok: boolean | null;
      embed_error: string | null;
      atom_count: number;
      sa_score: number | null;
      sa_label: string | null;
    }>("/lookup/inspect-smiles", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /** 3D-embed a SMILES and return a MOL block ready for 3Dmol.js. Used
   *  by the Ketcher modal's optional "📐 3D" toggle. Server LRU-caches
   *  by (smiles, minimise) so repeat calls for the same molecule are
   *  ~10ms; first call ~80-500ms depending on size + flexibility. The
   *  resulting conformer is GAS-PHASE — not a docked pose. The UI
   *  surfaces this caveat in a tooltip so users don't conflate it with
   *  binding prediction. */
  embedSmiles: (payload: { smiles: string; minimise?: boolean }) =>
    request<{
      valid: boolean;
      error: string | null;
      mol_block: string | null;
      atom_count: number;
    }>("/lookup/embed-smiles", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /** Submit the public contact form. Backend forwards to a Telegram bot.
   *  `website` is the honeypot field — leave empty; bots fill every
   *  input they find. Returns 200 + accepted:true on both genuine
   *  delivery AND honeypot-swallowed submissions so spam tooling can't
   *  probe whether the trap caught it. Throws ApiError on validation
   *  failures (422), rate limit (429), or Telegram delivery failures
   *  (502/503) so the form can show an actionable message. */
  submitContact: (payload: {
    name: string;
    email: string;
    message: string;
    /** "student" | "academic" | "industry" | "other" — required by the
     *  form, but typed loosely here so future role additions don't
     *  require a coordinated frontend+backend type bump. */
    role?: string;
    /** Free-text description of the user's role when role === "other".
     *  Appears in the Telegram notification as "Other — <text>" so
     *  triage isn't stuck staring at an unhelpful bare "Other". */
    role_other?: string;
    /** University, company, lab, or institution. Required by the form. */
    affiliation?: string;
    /** Country/region — optional. Free-form to avoid a 250-entry select. */
    country?: string;
    website?: string;
    turnstile_token?: string;
  }) =>
    request<{ accepted: boolean }>("/contact", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        role: payload.role ?? "",
        role_other: payload.role_other ?? "",
        affiliation: payload.affiliation ?? "",
        country: payload.country ?? "",
        website: payload.website ?? "",
        turnstile_token: payload.turnstile_token ?? "",
      }),
    }),

  /** Admin-only: top-level dashboard counters. Cheap; safe to poll.
   *  Throws ApiError(403) if the caller isn't the admin email — the
   *  frontend AdminPage uses that to render a "not authorized" card. */
  adminStats: () =>
    request<{
      total_users: number;
      total_jobs: number;
      jobs_24h: number;
      jobs_7d: number;
      jobs_running: number;
      jobs_failed_7d: number;
    }>("/admin/stats"),
  /** Admin-only: list every user with profile + job stats. */
  adminListUsers: () =>
    request<AdminUserRow[]>("/admin/users"),
  /** Admin-only: change a user's lifetime job quota. */
  adminSetQuota: (userId: string, jobQuota: number) =>
    request<AdminUserRow>(`/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify({ job_quota: jobQuota }),
    }),
  /** Admin-only: live status of the controlled RunPod GPU pod plus the
   *  watchdog's last-activity timer. Drives the Pod Control card. */
  adminPodStatus: () =>
    request<{
      configured: boolean;
      pod_id: string | null;
      name: string | null;
      desired_status: string | null;
      uptime_seconds: number | null;
      last_activity_seconds_ago: number | null;
      idle_threshold_seconds: number;
      error: string | null;
    }>("/admin/pod/status"),
  /** Admin-only: stop the GPU pod immediately. Idempotent. */
  adminPodStop: () =>
    request<{ ok: boolean; result: unknown }>("/admin/pod/stop", { method: "POST" }),
  /** Admin-only: resume the GPU pod. ~3-5 min to ready. */
  adminPodStart: () =>
    request<{ ok: boolean; result: unknown }>("/admin/pod/start", { method: "POST" }),
  /** Admin-only: hard-delete a user and everything they own. */
  adminDeleteUser: async (userId: string): Promise<void> => {
    const r = await fetch(`${BASE}/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { ...(await authHeader()) },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new ApiError(r.status, body || `DELETE failed (${r.status})`);
    }
  },
  createJob: (payload: JobCreatePayload) =>
    request<Job>("/jobs", { method: "POST", body: JSON.stringify(payload) }),
  // `key` is the share_id (preferred) or legacy integer ID; backend resolves
  // either form. Typed as `string | number` so callers can pass whichever
  // they have on hand without a manual coerce.
  getJob: (key: string | number) => request<Job>(`/jobs/${key}`),
  cancelJob: (key: string | number) =>
    request<Job>(`/jobs/${key}/cancel`, { method: "POST" }),
  /** AI assistant — natural-language compound edit. Calls Claude Haiku
   *  with the user's instruction + optional pocket context (target PDB
   *  + mutations). Returns the proposed new SMILES, a one-line
   *  rationale, optional warnings (PAINS/Lipinski/etc), and
   *  applied=true iff the new SMILES validated with RDKit and is safe
   *  to push back into Ketcher. */
  assistCompound: (payload: {
    smiles: string;
    instruction: string;
    target_pdb?: string;
    mutations?: string;
    /** Optional docking context — pass these only when a recent Quick
     *  dock result is available AND its smiles matches the current
     *  canvas SMILES. Stale dock data (post-edit) must NOT be sent —
     *  it would mislead the AI into reasoning about contacts that no
     *  longer apply. The backend uses this to flip the system prompt
     *  into docking-aware mode (residues must come from these lists,
     *  bias edits toward misses). */
    score?: number;
    hits?: string[];
    misses?: string[];
  }) =>
    request<{
      new_smiles: string;
      rationale: string;
      warnings: string[];
      applied: boolean;
    }>("/assist/compound", { method: "POST", body: JSON.stringify(payload) }),
  /** AI assistant — RDKit-only property panel. No LLM call, no cost,
   *  ~5ms server-side. Returns either {valid: true, ...full panel} or
   *  {valid: false, error}. */
  assistProperties: (smiles: string) =>
    request<{
      valid: boolean;
      canonical_smiles?: string;
      mw?: number; logp?: number; tpsa?: number;
      hba?: number; hbd?: number; rotatable_bonds?: number; heavy_atoms?: number;
      qed?: number;
      lipinski_pass?: boolean; veber_pass?: boolean;
      pains_hits?: { name: string; description: string }[];
      error?: string;
    }>("/assist/properties", { method: "POST", body: JSON.stringify({ smiles }) }),
  /** Generate a 3D conformer for a SMILES via ETKDG + UFF. Returns SDF
   *  text suitable for 3Dmol.js. Used by the Studio page's live 3D
   *  viewer to update the 3D structure as the user edits the 2D
   *  canvas. ~100-200ms typical. */
  assistConformer: (smiles: string) =>
    request<{ ok: boolean; sdf?: string; error?: string }>(
      "/assist/conformer",
      { method: "POST", body: JSON.stringify({ smiles }) },
    ),
  /** Pre-flight dockability check. Used at the Ketcher save gate so
   *  unsupported atoms (As, Pb, etc.), salt forms, and oversized
   *  molecules get blocked at the editor instead of failing later in
   *  the runner. Returns dockable=true with canonical_smiles, or
   *  dockable=false with a friendly reason + actionable suggestion. */
  assistDockability: (smiles: string) =>
    request<{
      dockable: boolean;
      reason?: string;
      suggestion?: string;
      canonical_smiles?: string;
    }>("/assist/dockability", { method: "POST", body: JSON.stringify({ smiles }) }),
  /** Quick dock — runs a fast (exhaustiveness=4) Vina dock against the
   *  user's selected target+mutation, ~5-15s on the GPU pod. Returns
   *  best score + residue contacts (hits + nearby misses). Powers the
   *  🎯 Quick dock button in the Ketcher AI sidebar.
   *
   *  Throws ApiError(403) when QUICK_DOCK_ENABLED=false on the backend
   *  — frontend uses that to render a "By request" CTA. */
  assistQuickDock: (payload: {
    smiles: string;
    target_pdb: string;
    chain?: string;
    mutation?: string;
    /** Optional pocket-box scaling factor. 1.0 = no change. 0.7 ≈ 16Å
     *  cube from the standard 22Å, forcing off-pocket-drifted ligands
     *  to stay near the canonical site. Used by the "Re-dock with tight
     *  box" salvage button on off-pocket Quick Dock results.
     *  Server-side clamped to [0.4, 1.0]. 2026-05-05. */
    box_scale?: number;
    /** Optional engine override. Default ("vina" / undefined) uses
     *  QuickVina2-GPU. "gnina" routes to the GNINA pod, which adds a
     *  CNN-based pose rescoring pass on top of Vina — often promotes
     *  buried in-pocket poses that Vina's affinity-only scoring under-
     *  ranked. Used by the "Validate with GNINA" cross-check button
     *  on off-pocket cells. Server falls back to Vina if GNINA isn't
     *  enabled on this deploy. 2026-05-05. */
    engine?: "vina" | "gnina";
  }) =>
    request<{
      ok: boolean;
      score?: number;
      hits?: string[];
      misses?: string[];
      pose_pdbqt_b64?: string;
      /** Resolved RCSB PDB id the dock actually used (e.g. "4OBE" when
       *  the request asked for catalog id "kras"). Frontend uses this
       *  to fetch the cleaned receptor for the docked-pose viewer. */
      pdb_id?: string;
      /** Resolved chain id (e.g. "A"). Same use as pdb_id. */
      chain?: string;
      error?: string;
      /** Mutation-aware-scoring transparency (2026-05-04). "mutant" when
       *  the dock used the PDBFixer-built mutant receptor; "wt" when no
       *  mutation was requested OR when the mutant build failed. */
      receptor_variant?: "mutant" | "wt";
      /** Populated only when a mutation was requested but the mutant
       *  build failed and we fell back to WT. UI should warn the user. */
      mutation_caveat?: string;
      /** Pose-pocket honesty (2026-05-04). Distance from docked-pose
       *  centroid to pocket box center, in Å. */
      pose_offset_a?: number;
      /** False when the chosen pose drifted off-pocket (offset > 6 Å OR
       *  zero contact residues). UI renders an amber "pose drifted"
       *  caveat — score is real but pose isn't in the canonical site. */
      pose_in_pocket?: boolean;
      /** Number of independent Vina re-rolls (1=happy path, 3=all drifted). */
      dock_attempts?: number;
    }>("/assist/quick_dock", { method: "POST", body: JSON.stringify(payload) }),
  /** Optimize loop — given the score + contacts from a prior quick_dock,
   *  asks Claude for 3 variant SMILES designed to gain contacts at the
   *  `misses` residues. Each variant is RDKit-validated server-side. */
  assistOptimize: (payload: {
    smiles: string;
    score: number;
    hits: string[];
    misses: string[];
    target_pdb?: string;
    mutations?: string;
    /** Base64-encoded PDBQT text of the parent ligand pose. Optional but
     *  strongly recommended: when sent, the backend computes geometric
     *  guidance (where the mutation residue sits relative to the parent
     *  pose, which contacted residue is closest to it, which direction
     *  to extend) and threads it into the AI prompt. Without this the
     *  AI gets "engage residue 315" but no directional context.
     *  2026-05-05 user question: "can the AI calculate where the mutation
     *  is and modify the structure to bring it close?" */
    parent_pose_pdbqt_b64?: string;
  }) =>
    /** Generate-Score-Filter loop response. The backend asks Claude for ~12
     *  candidate variants, drops the synthetically-implausible ones, batch-
     *  docks the survivors against the same target+mutation as the parent,
     *  and returns the top 3 ranked by composite fitness:
     *    delta_score × 1.0 + (4 − SA) × 0.3 + mutation_contact × 0.5
     *
     *  When the docking pipeline isn't available (pod down, no receptor
     *  cached) the backend falls back to returning AI variants WITHOUT
     *  score/delta/sa_score/fitness — the frontend then dispatches its
     *  own per-variant quick docks (existing fan-out path).
     */
    request<{
      variants: {
        new_smiles: string;
        rationale: string;
        /** Vina kcal/mol — lower = stronger binding. Present iff backend
         *  successfully batch-docked this variant. */
        score?: number;
        /** parent_score - score; positive = improvement. */
        delta?: number;
        /** Synthetic Accessibility Score, 1=easy, 10=impossible. */
        sa_score?: number;
        /** Composite ranking value used to pick the top 3. */
        fitness?: number;
        /** True iff variant docked-pose contacts the mutated residue. */
        mutation_contact?: boolean;
        hits?: string[];
        misses?: string[];
        /** AI's own predicted improvement (Hard-Constraint Reject Loop).
         *  Used by the calibration badge to show "AI called it" when
         *  predicted Δ matches actual Δ within ~0.5. */
        predicted_improvement_kcal?: number;
        /** AI's own predicted SA Score. Compared to server-computed
         *  sa_score for calibration drift. */
        predicted_sa_score?: number;
        /** Residue label this variant was designed to engage, or null. */
        mutation_target?: string | null;
        /** Pose-pocket honesty (added 2026-05-05). True when the docked
         *  pose centroid is inside the search box; False when it drifted.
         *  Drives the small "drifted off-pocket" warning chip on the
         *  variant card AND is fed into the composite fitness function
         *  server-side (off-pocket variants get a -0.6 fitness penalty
         *  so they rank below cleanly-docked alternatives). */
        pose_in_pocket?: boolean;
        /** Centroid-to-pocket-center distance for the chosen pose, Å. */
        pose_offset_a?: number;
      }[];
      /** Diagnostics — useful for debug, not currently surfaced in UI. */
      candidates_generated?: number;
      candidates_filtered?: number;
      candidates_docked?: number;
      candidates_self_rejected?: number;
      candidates_top_up?: number;
      /** Human-readable hint, present on fallback paths (no docking
       *  pipeline, all candidates unsynthesisable, etc). */
      note?: string;
      /** Mutation-aware-scoring transparency (Tier 1 #5, 2026-05-04).
       *  "mutant" when the variants were docked against the PDBFixer-built
       *  mutant receptor; "wt" when no mutation was requested OR when the
       *  mutant build failed and we fell back to WT. */
      receptor_variant?: "mutant" | "wt";
      /** Populated only when the user requested a mutation but we had to
       *  fall back to WT (mutant build crashed, residue verify failed,
       *  etc). Render as a soft amber caveat — the relative Δ is still
       *  meaningful but the absolute score isn't mutation-aware. */
      mutation_caveat?: string;
    }>("/assist/optimize", { method: "POST", body: JSON.stringify(payload) }),
  /** Report an issue on a job. Owner-only. Sends the user's free-form
   *  comment + job context to our Telegram bot so we can triage from a
   *  push notification. Server returns 204; we resolve to void. */
  reportJob: async (key: string | number, comment: string): Promise<void> => {
    const r = await fetch(`${BASE}/jobs/${key}/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeader()),
      },
      body: JSON.stringify({ comment }),
    });
    if (!r.ok) {
      let detail: string | undefined;
      try { detail = (await r.json())?.detail; } catch { /* not JSON */ }
      throw new ApiError(r.status, detail || `${r.status} ${r.statusText}`);
    }
  },
  /** Patch the user-editable fields on a job (currently title and tags).
   *  Both fields are optional — omitting one leaves it unchanged. Used by
   *  the History page tag picker to color-code jobs. Returns the updated
   *  Job; callers should invalidate the ["jobs"] query so the list
   *  re-renders with the new tags. */
  updateJob: (key: string | number, patch: { title?: string | null; tags?: string[] }) =>
    request<Job>(`/jobs/${key}`, { method: "PATCH", body: JSON.stringify(patch) }),
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
  /** List the signed-in user's jobs, newest first.
   *
   *  Pagination via `offset` + `limit`. The backend caps `limit` at 200 but
   *  the History page hits this with limit=25 (one "page") and bumps the
   *  offset on each "Load more" click via useInfiniteQuery. A response with
   *  fewer than `limit` rows means there are no more pages.
   *
   *  Both args are optional so existing callers (none today, but future
   *  consumers) get the legacy 20-row default. */
  listJobs: (offset = 0, limit = 25) =>
    request<Job[]>(`/jobs?offset=${offset}&limit=${limit}`),
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
