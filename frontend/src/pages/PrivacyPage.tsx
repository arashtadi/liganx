import { Link } from "react-router-dom";

/**
 * Privacy Policy — describes what data Liganx collects, how it's stored, and
 * what users can do about it. Kept short and concrete on purpose; lawyers
 * should review before any commercial launch but for a research preview
 * the most important thing is being honest about what we do with input
 * structures and SMILES.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 prose prose-slate dark:prose-invert">
      <h1 className="text-3xl font-bold text-ink dark:text-white mb-1">Privacy Policy</h1>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-8">
        Last updated: April 28, 2026 · Liganx Beta
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">What we collect</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        When you submit a docking job, Liganx stores the inputs you provide so
        we can show you results: the PDB ID (or uploaded PDB file), the chain,
        the mutation list, the compound SMILES strings, and any names you
        attach to compounds. We also store the docking outputs we compute
        from those inputs — Vina/Vinardo scores, ProLIF interaction
        fingerprints, ADMET descriptors, the docked pose files, and the
        cross-docking validation cache. Job records are keyed to a random
        share ID, not to a user account.
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">What we don't collect</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Liganx has no user accounts, no logins, and no analytics tracker on
        the matrix or pose-detail pages. We don't ask for your name, email,
        or affiliation. We don't read referer headers for cross-site tracking.
        The only network requests our frontend makes are to our own API
        (api.liganx.com) for jobs and to RCSB / PubChem for structure and
        compound lookups when you autocomplete in the new-job form.
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">Sharing & confidentiality</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Anyone with a job's share URL can view its inputs and outputs. Treat
        share URLs like passwords for confidential work — don't paste them
        into public channels if your SMILES are proprietary. We don't have a
        password-protected sharing mode yet; that's tracked as a future
        feature. If you need to remove a job from our database, email the
        contact below with the share ID and we'll delete it.
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">Where data lives</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Job metadata lives in a Supabase Postgres database in US-East-1.
        Pose files are stored on Fly.io's persistent volume in IAD (Ashburn,
        Virginia). Raw RCSB PDB caches and FoldX/PDBFixer derivatives live
        on the same Fly.io VM. Pod GPU docking workers run on RunPod
        infrastructure; receptor and ligand files are sent there for the
        duration of a single docking call and discarded after the result
        returns. No data leaves North American jurisdictions in the current
        deployment.
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">Cookies & local storage</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Liganx uses one piece of browser local storage: your dark/light theme
        preference. No cookies, no tracking pixels, no third-party scripts.
        Vercel (our frontend host) and Fly.io (our backend host) may collect
        request logs that include IP addresses for normal operational
        purposes; we don't query those logs except to debug outages.
      </p>

      <h2 className="text-lg font-semibold text-ink dark:text-white mt-6 mb-2">Contact</h2>
      <p className="text-sm text-slate-700 dark:text-slate-300">
        Questions, deletion requests, or anything else: email
        {" "}
        <a href="mailto:hello@liganx.com" className="text-delta-700 dark:text-delta-400 underline">hello@liganx.com</a>.
        See also our{" "}
        <Link to="/terms" className="text-delta-700 dark:text-delta-400 underline">Terms of Service</Link>.
      </p>
    </div>
  );
}
