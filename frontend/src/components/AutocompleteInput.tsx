import { useEffect, useId, useRef, useState } from "react";

/**
 * Generic autocomplete input.
 *
 * The caller owns the value and provides a `fetchSuggestions(q)` function;
 * we handle debouncing, keyboard navigation, click-outside dismissal, and
 * rendering the dropdown.
 *
 * Two modes for what `value` represents:
 *  - "single"  — the whole input is one token (e.g. PDB ID)
 *  - "tokens"  — comma-separated list; suggestions apply to the LAST token
 *               (e.g. mutations field "T790M, L8…")
 *
 * `renderItem` lets the caller customize how each suggestion looks. The result
 * of `getValue(item)` is what gets inserted on selection.
 */

export interface AutocompleteInputProps<T> {
  value: string;
  onChange: (next: string) => void;
  fetchSuggestions: (q: string) => Promise<T[]>;
  /** What text gets inserted when the user picks `item`. */
  getValue: (item: T) => string;
  /** Render the dropdown row. Should be visually compact. */
  renderItem: (item: T, isActive: boolean) => React.ReactNode;
  mode?: "single" | "tokens";
  placeholder?: string;
  className?: string;
  /** Min characters before fetching; defaults to 1 (so first keystroke fires). */
  minChars?: number;
  /** Debounce delay in ms — defaults to 200. */
  debounceMs?: number;
  /** Show suggestions on focus even with empty query? Useful for picker mode. */
  openOnFocus?: boolean;
  inputClassName?: string;
  /** Extra props passed to the underlying input (e.g. maxLength). */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  /** Optional fallback to render when the dropdown is open but has no items
   *  and we're not currently loading. Useful for "type it anyway" hints so
   *  the user doesn't hit a dead-end when their query has no autocomplete
   *  match. The dropdown stays open so the hint is visible alongside the input. */
  emptyState?: React.ReactNode;
  /** When true, dropdown rows render with a checkbox and the user can pick
   *  multiple items in one open. A footer button commits the batch via
   *  onMultiCommit, which receives the selected items in pick order.
   *  Cap with `multiMax` (default 5). Useful for token-mode fields where
   *  the user often wants to add several at once (mutations, compound
   *  names) instead of re-opening the dropdown for each. */
  multi?: boolean;
  multiMax?: number;
  /** Called when the user clicks the "Add N" footer button in multi mode.
   *  Receives the items in the order they were checked. Caller is
   *  responsible for inserting them into the value (we don't auto-update
   *  via getValue/onChange in multi mode because the join semantics
   *  vary — comma-list, separate rows, etc.). */
  onMultiCommit?: (items: T[]) => void;
}

export default function AutocompleteInput<T>({
  value,
  onChange,
  fetchSuggestions,
  getValue,
  renderItem,
  mode = "single",
  placeholder,
  className = "",
  minChars = 1,
  debounceMs = 200,
  openOnFocus = false,
  inputClassName = "input",
  inputProps,
  emptyState,
  multi = false,
  multiMax = 5,
  onMultiCommit,
}: AutocompleteInputProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Multi-select state — preserved across re-fetches so the user can
  // refine their query and the existing checks survive (matched on the
  // string returned by getValue, since the suggestion objects can be
  // re-allocated by the fetcher between renders). Cleared when the
  // dropdown closes, so opening it next time starts fresh.
  const [picked, setPicked] = useState<T[]>([]);
  const pickedKeys = new Set(picked.map((p) => getValue(p)));
  function togglePick(item: T) {
    const key = getValue(item);
    setPicked((cur) => {
      // Always allow UN-checking — that's how the user makes room
      // when they've hit the cap and want to swap a pick.
      if (cur.some((c) => getValue(c) === key)) {
        return cur.filter((c) => getValue(c) !== key);
      }
      // HARD cap: once N picks are checked, additional clicks are
      // ignored. The dropdown row visually disables (greyed out,
      // not-allowed cursor) so the click feels intentional rather
      // than broken. Earlier behaviour silently dropped the oldest
      // pick to make room — confusing because the user couldn't
      // tell which entry got evicted.
      if (cur.length >= multiMax) return cur;
      return [...cur, item];
    });
  }
  // Reset picks when the dropdown closes so reopening starts clean.
  useEffect(() => {
    if (!open) setPicked([]);
  }, [open]);

  // ── Viewport-aware sizing ─────────────────────────────────────────────
  // The dropdown was rendering with a fixed max-h-72 list AND a footer
  // beneath, so on a long suggestion list the "Add N" button could end
  // up below the visible viewport — invisible until the user scrolled
  // the page. We now measure the input on each render and:
  //   • Compute the available pixels below it (and above it).
  //   • If above-space > below-space AND the list would benefit, FLIP
  //     the dropdown to open upward (anchored to the input top).
  //   • Cap the LIST height at the available space minus the footer
  //     reserve, so the footer (when in multi mode) always lands inside
  //     the viewport regardless of how many suggestions matched.
  const FOOTER_RESERVE_PX = multi ? 56 : 0; // height of the sticky footer
  const VIEWPORT_MARGIN_PX = 16;             // breathing room from edges
  const [pos, setPos] = useState<{
    placement: "below" | "above";
    listMaxPx: number;
  }>({ placement: "below", listMaxPx: 288 });
  useEffect(() => {
    if (!open) return;
    function recompute() {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const spaceBelow = vh - rect.bottom - VIEWPORT_MARGIN_PX;
      const spaceAbove = rect.top - VIEWPORT_MARGIN_PX;
      // Prefer below by default — only flip when above has materially
      // more room (>50px advantage) AND below is genuinely cramped
      // (<200px). Avoids flicker on borderline cases.
      const flip = spaceAbove > spaceBelow + 50 && spaceBelow < 200;
      const usable = Math.max(120, (flip ? spaceAbove : spaceBelow) - FOOTER_RESERVE_PX);
      setPos({
        placement: flip ? "above" : "below",
        listMaxPx: Math.min(420, usable), // cap at 420px so very tall
                                          // viewports don't get a giant
                                          // overwhelming list
      });
    }
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true); // capture nested scrollers
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open, FOOTER_RESERVE_PX]);

  // Compute the "current token" — what we actually feed to the suggester.
  // For tokens mode that's the slice after the last comma; for single mode it's
  // the whole value.
  const currentToken = mode === "tokens"
    ? value.split(",").pop()?.trim() ?? ""
    : value.trim();

  // Debounced fetch on token change. We re-fetch whenever the user types or
  // pastes, so the dropdown stays fresh.
  useEffect(() => {
    if (currentToken.length < minChars) {
      // openOnFocus uses an empty-query fetch so the user gets a picker on focus
      if (openOnFocus && open && currentToken.length === 0) {
        let cancelled = false;
        fetchSuggestions("").then((r) => { if (!cancelled) setItems(r); }).catch(() => {});
        return () => { cancelled = true; };
      }
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const next = await fetchSuggestions(currentToken);
        if (!cancelled) {
          setItems(next);
          setActive(0);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, debounceMs);
    return () => { cancelled = true; clearTimeout(handle); };
    // fetchSuggestions is intentionally NOT in deps — caller often inlines a closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentToken, minChars, debounceMs, openOnFocus, open]);

  // Close on click-outside / Esc
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(item: T) {
    const inserted = getValue(item);
    if (mode === "tokens") {
      const parts = value.split(",");
      parts[parts.length - 1] = " " + inserted;  // replace the last (in-progress) token
      // Append a trailing comma + space so the user can keep typing the next one
      const joined = parts.map((p, i) => (i === 0 ? p.trimStart() : p)).join(",").trim();
      onChange(joined.endsWith(",") ? joined + " " : joined + ", ");
    } else {
      onChange(inserted);
    }
    setOpen(false);
    setItems([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      e.preventDefault();
      return;
    }
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      // Only intercept Enter if there's a real suggestion to pick. Otherwise
      // let the form-submit / default behavior take over.
      if (items[active]) {
        e.preventDefault();
        pick(items[active]);
      }
    } else if (e.key === "Tab" && items[active]) {
      // Tab also accepts the highlighted suggestion — common convention
      e.preventDefault();
      pick(items[active]);
    }
  }

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <input
        {...inputProps}
        className={inputClassName}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {open && items.length > 0 && (
        <div
          className={
            "absolute left-0 right-0 z-30 bg-white border border-slate-200 rounded-lg shadow-xl dark:bg-slate-800 dark:border-slate-700 " +
            (pos.placement === "above" ? "bottom-full mb-1" : "top-full mt-1")
          }
        >
          <ul
            id={listId}
            role="listbox"
            className="overflow-y-auto py-1"
            // Inline maxHeight from the viewport calculation — ensures
            // the footer (when in multi mode) ALWAYS lands inside the
            // visible viewport, even when there are 50+ suggestions.
            // Without this the Add button could disappear below the fold.
            style={{ maxHeight: `${pos.listMaxPx}px` }}
          >
            {items.map((item, i) => {
              const isPicked = multi && pickedKeys.has(getValue(item));
              // At-cap unchecked rows are visually + interactively
              // disabled. Already-picked rows stay clickable so the
              // user can uncheck to free a slot.
              const atCapAndUnchecked = multi && !isPicked && picked.length >= multiMax;
              return (
                <li
                  key={i}
                  role="option"
                  aria-selected={multi ? isPicked : i === active}
                  aria-disabled={atCapAndUnchecked || undefined}
                  title={atCapAndUnchecked ? `Maximum ${multiMax} selected — uncheck one to swap` : undefined}
                  onMouseDown={(e) => {
                    // In multi mode a click toggles the checkbox without
                    // closing the dropdown, so the user can pick several
                    // in one open. In single mode it commits as before.
                    e.preventDefault();
                    if (atCapAndUnchecked) return; // hard cap: ignore
                    if (multi) togglePick(item);
                    else pick(item);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`text-sm transition-colors flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 last:border-b-0 ${
                    multi ? "px-3.5 py-2.5" : "px-3 py-1.5"
                  } ${
                    atCapAndUnchecked
                      ? "opacity-40 cursor-not-allowed"
                      : "cursor-pointer"
                  } ${
                    isPicked
                      ? "bg-delta-50 dark:bg-delta-900/30"
                      : atCapAndUnchecked
                        ? ""
                        : i === active
                          ? "bg-slate-50 dark:bg-slate-700/50"
                          : "hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {multi && (
                    <span
                      aria-hidden="true"
                      className={
                        "shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors " +
                        (isPicked
                          ? "bg-delta-600 border-delta-600 text-white"
                          : atCapAndUnchecked
                            ? "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                            : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900")
                      }
                    >
                      {isPicked && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  )}
                  <span className="flex-1 min-w-0">{renderItem(item, i === active)}</span>
                </li>
              );
            })}
          </ul>
          {/* Multi-select footer — sticky bar with selected count + commit
              button. Disabled state when no picks; cap warning when at max. */}
          {multi && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 rounded-b-lg">
              <span
                className={
                  "text-[11px] " +
                  (picked.length >= multiMax
                    ? "text-amber-700 dark:text-amber-400 font-semibold"
                    : "text-slate-600 dark:text-slate-400")
                }
              >
                {picked.length === 0
                  ? `Pick up to ${multiMax}`
                  : picked.length >= multiMax
                    ? `${picked.length}/${multiMax} max — uncheck one to add more`
                    : `${picked.length}/${multiMax} selected`}
              </span>
              <div className="flex items-center gap-1.5">
                {picked.length > 0 && (
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); setPicked([]); }}
                    className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1 transition-colors"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  disabled={picked.length === 0}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (picked.length === 0) return;
                    onMultiCommit?.(picked);
                    setPicked([]);
                    setOpen(false);
                  }}
                  className="text-[11px] font-semibold px-3 py-1 rounded-md bg-delta-600 hover:bg-delta-700 text-white disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors"
                >
                  Add {picked.length || ""}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {open && loading && items.length === 0 && currentToken.length >= minChars && (
        <div
          className={
            "absolute left-0 right-0 z-30 bg-white border border-slate-200 rounded-lg shadow-xl px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 " +
            (pos.placement === "above" ? "bottom-full mb-1" : "top-full mt-1")
          }
        >
          Searching…
        </div>
      )}
      {/* Empty-state hint: open, not loading, no items, and the user has
          actually typed something (or focus-opened with no min). Rendered
          inside the same dropdown shell so it visually replaces the list. */}
      {open && !loading && items.length === 0 && emptyState !== undefined &&
       (currentToken.length >= minChars || (openOnFocus && minChars === 0)) && (
        <div
          className={
            "absolute left-0 right-0 z-30 bg-white border border-slate-200 rounded-lg shadow-xl px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 " +
            (pos.placement === "above" ? "bottom-full mb-1" : "top-full mt-1")
          }
        >
          {emptyState}
        </div>
      )}
    </div>
  );
}
