/**
 * Job tag presets — color-coded labels surfaced on the History page.
 *
 * The backend stores tags as a free-form list[str] on Job.tags. We define
 * a small preset list here so the UI can:
 *
 *   1. Render preset tags with a consistent color + icon (e.g. all
 *      "favorite" tags across all jobs use the same amber star).
 *   2. Treat unknown tags as user-defined custom tags and render them
 *      in a neutral slate chip — still useful as labels, just without
 *      the color signal.
 *
 * The string `value` is what's actually persisted in DB. Don't rename
 * existing values without a migration of the tags array — already-tagged
 * jobs would silently lose their color.
 */

export interface JobTag {
  /** DB-persisted value. Lowercase, hyphenated. */
  value: string;
  /** Human label for menus and chips. */
  label: string;
  /** Single-character icon shown on the chip — kept tiny so the chip stays
   *  compact in the row. Star for favorite, dot for plain colors. */
  icon: string;
  /** Tailwind classes applied to the chip when this tag is set. */
  chip: string;
  /** Tailwind classes for the indicator dot in the picker menu. */
  dot: string;
}

export const TAG_PRESETS: JobTag[] = [
  {
    value: "favorite",
    label: "Favorite",
    icon: "★",
    chip: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-700",
    dot: "bg-amber-400",
  },
  {
    value: "promising",
    label: "Promising",
    icon: "●",
    chip: "bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-700",
    dot: "bg-emerald-500",
  },
  {
    value: "bad",
    label: "Bad",
    icon: "●",
    chip: "bg-rose-100 text-rose-800 ring-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-700",
    dot: "bg-rose-500",
  },
  {
    value: "send-to-lab",
    label: "Send to lab",
    icon: "●",
    chip: "bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-700",
    dot: "bg-sky-500",
  },
  {
    value: "in-review",
    label: "In review",
    icon: "●",
    chip: "bg-violet-100 text-violet-800 ring-violet-300 dark:bg-violet-900/40 dark:text-violet-200 dark:ring-violet-700",
    dot: "bg-violet-500",
  },
  {
    value: "follow-up",
    label: "Follow up",
    icon: "●",
    chip: "bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-900/40 dark:text-orange-200 dark:ring-orange-700",
    dot: "bg-orange-500",
  },
  {
    value: "archived",
    label: "Archived",
    icon: "●",
    chip: "bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600",
    dot: "bg-slate-400",
  },
];

/** Quick lookup by tag value. Unknown values render as custom (neutral) chips. */
export const TAG_BY_VALUE: Record<string, JobTag> = Object.fromEntries(
  TAG_PRESETS.map((t) => [t.value, t]),
);

/** Neutral chip for a custom (non-preset) tag. */
export const CUSTOM_TAG_CHIP =
  "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700";

/** Sort order: tags with a preset come first in their preset order, then
 *  custom tags alphabetically. Used by both the row chip strip and the
 *  filter bar so the same tag shows up in the same place everywhere. */
export function sortTags(tags: string[]): string[] {
  const presetOrder = new Map(TAG_PRESETS.map((t, i) => [t.value, i]));
  return [...tags].sort((a, b) => {
    const pa = presetOrder.get(a);
    const pb = presetOrder.get(b);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return a.localeCompare(b);
  });
}
