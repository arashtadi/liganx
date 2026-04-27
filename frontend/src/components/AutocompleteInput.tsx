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
}: AutocompleteInputProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

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
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-lg shadow-xl max-h-72 overflow-y-auto py-1 dark:bg-slate-800 dark:border-slate-700"
        >
          {items.map((item, i) => (
            <li
              key={i}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(item); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 text-sm transition-colors ${
                i === active ? "bg-delta-50 dark:bg-delta-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              {renderItem(item, i === active)}
            </li>
          ))}
        </ul>
      )}
      {open && loading && items.length === 0 && currentToken.length >= minChars && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-lg shadow-xl px-3 py-2 text-xs text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">
          Searching…
        </div>
      )}
    </div>
  );
}
