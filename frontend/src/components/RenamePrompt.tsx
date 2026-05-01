/**
 * RenamePrompt — centered modal that asks the user to name (or rename) a
 * compound after a Ketcher edit changes its structure. Used in two places:
 *   • NewJobPage: when a row's named compound gets a new SMILES from the
 *     sketcher, the original name no longer fits and we force a rename.
 *   • CompoundsPage: when the user edits a saved compound and chooses
 *     "Save as a new compound", this prompt collects the new name.
 *
 * Behavior:
 *   - Pre-fills the input with `initialName` (callers usually pass
 *     `OldName_` so the user can append a suffix).
 *   - Auto-focuses + selects the input on mount.
 *   - Validates non-empty and not just `_`.
 *   - Blocks duplicates against `existingNames` (case-insensitive),
 *     EXCEPT for `currentRowName` — keeping the old name is allowed as
 *     deliberate edit-in-place.
 *   - Cancel closes without saving (caller decides whether to drop the
 *     SMILES change or roll back state).
 */
import { useEffect, useRef, useState } from "react";

export interface RenamePromptProps {
  initialName: string;
  existingNames: string[];
  /** The name on the entity being renamed BEFORE this prompt fired.
   *  Allowed even though it appears in `existingNames`, since changing
   *  the SMILES under the same name is a deliberate edit-in-place. */
  currentRowName: string;
  /** Optional title override — defaults to "Name your modified structure".
   *  CompoundsPage passes "Save as a new compound" for the save-as-new flow. */
  title?: string;
  /** Optional subtitle override. The default explains why renaming is
   *  required ("you changed the structure of X"). Override when context
   *  is different (e.g. branching from an Edit dialog). */
  subtitle?: React.ReactNode;
  /** Optional submit-button label override. Defaults to "Save & use". */
  submitLabel?: string;
  onCancel: () => void;
  onSave: (newName: string) => void;
}

export default function RenamePrompt({
  initialName,
  existingNames,
  currentRowName,
  title,
  subtitle,
  submitLabel,
  onCancel,
  onSave,
}: RenamePromptProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus + select-all so the user can immediately type a suffix
  // after the underscore (or wipe the value entirely with one keystroke).
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => window.clearTimeout(id);
  }, []);

  const trimmed = name.trim();
  const reservedLower = new Set(
    existingNames
      .filter((n) => n.toLowerCase() !== currentRowName.toLowerCase())
      .map((n) => n.toLowerCase()),
  );
  const isDuplicate = trimmed.length > 0 && reservedLower.has(trimmed.toLowerCase());
  const isEmpty = trimmed.length === 0;
  const canSave = !isEmpty && !isDuplicate && trimmed !== "_";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (canSave) onSave(trimmed);
  }

  const headerTitle = title ?? "Name your modified structure";
  const defaultSubtitle = (
    <>
      You changed the structure of <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{currentRowName}</span>,
      so it isn&apos;t {currentRowName} anymore. Give the new molecule its
      own name — it&apos;ll be saved to your library.
    </>
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-base font-semibold text-ink dark:text-white">
            {headerTitle}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {subtitle ?? defaultSubtitle}
          </p>
        </header>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div>
            <label htmlFor="rename-name" className="label">New compound name</label>
            <input
              id="rename-name"
              ref={inputRef}
              type="text"
              className="input font-mono"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={initialName}
              maxLength={200}
            />
            {isDuplicate && (
              <p className="mt-1.5 text-xs text-rose-700 dark:text-rose-400">
                <span className="font-semibold">{trimmed}</span> already exists in your library — pick a different name.
              </p>
            )}
            {isEmpty && (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Type a name to continue.
              </p>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="btn-ghost btn-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitLabel ?? "Save & use"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
