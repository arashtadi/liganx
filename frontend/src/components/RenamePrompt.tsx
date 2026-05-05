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
  /** Optional "Update <OriginalName>" path — when provided, surfaces a
   *  prominent secondary action that overwrites the existing library
   *  entry instead of forcing the user to create a new one. Without
   *  this, users were getting stuck saving Aspirin_, Aspirin__, etc.
   *  every time they iterated on the same compound — they didn't see
   *  that typing the SAME name back was allowed because the input
   *  was pre-filled with the underscore-suffixed variant. */
  onOverwrite?: () => void;
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
  onOverwrite,
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

  // currentRowName is empty when the popup is fired from an unnamed row
  // — i.e. a brand-new compound the user just drew, not an edit of a
  // saved compound. The "you changed the structure of X" copy doesn't
  // make sense in that case, so we swap to a "name your new compound"
  // header + subtitle. NewJobPage now always fires the popup on
  // Promote/Check&Use (per 2026-05-05 user request) so this branch
  // matters: the unnamed-row case is now common, not exceptional.
  const isUnnamed = currentRowName.length === 0;
  const headerTitle = title ?? (
    isUnnamed
      ? "Save your new compound"
      : onOverwrite
        ? "Save your edit"
        : "Name your modified structure"
  );
  const defaultSubtitle = isUnnamed ? (
    <>
      Give your new structure a name to save it to your library and use it
      in the job below.
    </>
  ) : onOverwrite ? (
    <>
      You changed the structure of <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{currentRowName}</span>.
      Update it in your library, or save the modified molecule under a new name.
    </>
  ) : (
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

        {/* PRIMARY action when overwrite is available — full-width
            emerald button. The previous design buried the "use the
            same name" path behind the rename input, so users iterating
            on the same compound kept ending up with foo, foo_, foo__
            entries. With this button surfaced as a clear primary
            action, one click overwrites the library entry. */}
        {onOverwrite && (
          <div className="px-5 pt-4">
            <button
              type="button"
              onClick={onOverwrite}
              className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <span aria-hidden="true">↻</span>
              Update <span className="font-mono">{currentRowName}</span> in your library
            </button>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 text-center">
              Replaces the saved structure under the same name.
            </p>
          </div>
        )}

        {/* SECONDARY path — save as a new compound. Visually demoted
            (smaller header, divider above) when the overwrite path is
            present so the user's eye lands on Update first. */}
        <form onSubmit={handleSubmit} className={"px-5 py-4 space-y-3 " + (onOverwrite ? "border-t border-slate-200 dark:border-slate-700 mt-4" : "")}>
          {onOverwrite && (
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">
              Or save as a new compound
            </div>
          )}
          <div>
            <label htmlFor="rename-name" className="label">{onOverwrite ? "New name" : "New compound name"}</label>
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
              {submitLabel ?? (onOverwrite ? "Save as new" : "Save & use")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
