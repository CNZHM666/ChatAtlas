import { Check, ChevronDown, Cpu, RefreshCw, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "../model-picker.css";

export interface ModelPickerItem {
  value: string;
  label: string;
  /** Optional accessible label when visual formatting differs from raw ID. */
  ariaLabel?: string;
  subtitle?: string;
  group?: string;
  badge?: string;
  searchText?: string;
}

export interface ModelPickerSyncedSelect {
  id?: string;
  placeholderOption?: string;
  optionText?: (item: ModelPickerItem) => string;
  grouped?: boolean;
}

export interface ModelPickerPopoverProps {
  items: ModelPickerItem[];
  value: string;
  displayValue: string;
  /** Optional raw value used in button aria-label so existing accessible names stay stable. */
  ariaValue?: string;
  placeholder?: string;
  ariaLabel: string;
  title?: string;
  zh: boolean;
  disabled?: boolean;
  busy?: boolean;
  variant?: "composer" | "settings";
  searchable?: boolean;
  searchPlaceholder?: string;
  headerTitle?: string;
  emptyAction?: { label: string; onClick: () => void; loading?: boolean };
  footerAction?: { label: string; onClick: () => void; icon?: ReactNode };
  /**
   * When true, pressing ArrowDown on the trigger or opening the menu focuses the selected option directly
   * (preserving listbox keyboard ergonomics for compact composer menus).
   */
  focusOptionOnOpen?: boolean;
  /** Optional visually-hidden synced native <select> so form labels and tests using HTMLSelectElement stay compatible. */
  syncedSelect?: ModelPickerSyncedSelect;
  onChange: (value: string) => void;
}

/** Infer a concise, human-friendly capability pill from a model ID (purely visual, aria-hidden). */
function inferModelBadge(modelId: string, zh: boolean): string | undefined {
  const id = modelId.toLowerCase();
  if (!id) return undefined;
  if (/(reasoner|thinking|\br1\b|\bo1\b|\bo3\b|\bo4\b|qwq)/.test(id)) return zh ? "推理" : "Reasoning";
  if (/(flash|mini|nano|haiku|lite|turbo|fast)/.test(id)) return zh ? "极速" : "Fast";
  if (/(max|pro|opus|sonnet|ultra|4\.5|4o|plus)/.test(id)) return zh ? "旗舰" : "Flagship";
  return undefined;
}

export function ModelPickerPopover({
  items,
  value,
  displayValue,
  ariaValue,
  placeholder,
  ariaLabel,
  title,
  zh,
  disabled = false,
  busy = false,
  variant = "settings",
  searchable,
  searchPlaceholder,
  headerTitle,
  emptyAction,
  footerAction,
  focusOptionOnOpen = false,
  syncedSelect,
  onChange,
}: ModelPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | undefined>(undefined);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popupId = useId();
  const isBlocked = disabled || busy;

  const showSearch = searchable ?? (variant === "settings" ? items.length >= 6 : items.length >= 6);

  const filteredItems = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return items;
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    return items.filter((item) => {
      const haystack = (item.searchText ?? `${item.label} ${item.subtitle ?? ""} ${item.group ?? ""} ${item.value}`).toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [items, query]);

  const groupedFiltered = useMemo(() => {
    const map = new Map<string, ModelPickerItem[]>();
    for (const item of filteredItems) {
      const key = item.group ?? "";
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()];
  }, [filteredItems]);

  const groupedAllForSelect = useMemo(() => {
    const map = new Map<string, ModelPickerItem[]>();
    for (const item of items) {
      const key = item.group ?? "";
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()];
  }, [items]);

  const close = (returnFocus = true) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportW = window.innerWidth || 1024;
      const viewportH = window.innerHeight || 768;
      const desiredWidth = variant === "settings"
        ? Math.max(rect.width, Math.min(340, viewportW - 24))
        : Math.min(312, Math.max(264, rect.width + 80), viewportW - 24);
      const estimatedHeight = 320;
      const spaceBelow = viewportH - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < Math.min(estimatedHeight, 220) && spaceAbove > spaceBelow;
      setPlacement(openUp ? "top" : "bottom");

      let left = variant === "composer" ? rect.right - desiredWidth : rect.left;
      left = Math.max(12, Math.min(left, viewportW - desiredWidth - 12));
      const maxHeight = Math.max(180, Math.min(340, (openUp ? spaceAbove : spaceBelow) - 8));

      setPopoverStyle(
        openUp
          ? { position: "fixed", left, bottom: Math.max(12, viewportH - rect.top + 6), width: desiredWidth, maxHeight }
          : { position: "fixed", left, top: Math.max(12, rect.bottom + 6), width: desiredWidth, maxHeight },
      );
    };

    updatePosition();

    // Focus target on open
    if (!focusOptionOnOpen && showSearch && searchRef.current) {
      searchRef.current.focus({ preventScroll: true });
    } else {
      const menu = menuRef.current;
      const selectedOption = menu?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? menu?.querySelector<HTMLButtonElement>('[role="option"]');
      selectedOption?.focus({ preventScroll: true });
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    };
    const onResizeOrScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      updatePosition();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
    };
  }, [open, variant, showSearch, focusOptionOnOpen]);

  useEffect(() => {
    if (isBlocked && open) {
      setOpen(false);
      setQuery("");
    }
  }, [isBlocked, open]);

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      setQuery("");
      return;
    }
    const isInputFocused = document.activeElement === searchRef.current;
    if (isInputFocused && (event.key === "Home" || event.key === "End")) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!options.length) return;
    event.preventDefault();
    const index = options.findIndex((option) => option === document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : index < 0
            ? event.key === "ArrowDown" ? 0 : options.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next].focus();
    options[next].scrollIntoView?.({ block: "nearest" });
  };

  const selectedItem = useMemo(() => items.find((item) => item.value === value), [items, value]);
  const triggerText = displayValue || placeholder || (zh ? "选择模型" : "Select model");
  const isEmptySelection = !value && !displayValue;

  const popoverNode = open ? (
    <div
      ref={menuRef}
      id={popupId}
      className={`atlas-model-popover is-${variant} is-${placement}`}
      style={popoverStyle}
      onKeyDown={handleMenuKeyDown}
    >
      {(headerTitle || showSearch) ? (
        <div className="atlas-model-popover-head">
          {headerTitle ? (
            <div className="atlas-model-popover-title">
              <span>{headerTitle}</span>
              <span className="atlas-model-popover-count" aria-hidden="true">{items.length}</span>
            </div>
          ) : null}
          {showSearch ? (
            <div className="atlas-model-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder={searchPlaceholder ?? (zh ? "搜索模型名称或 ID…" : "Search models…")}
                aria-label={zh ? "搜索模型" : "Search models"}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && filteredItems.length === 1) {
                    event.preventDefault();
                    const sole = filteredItems[0];
                    close(true);
                    if (sole.value !== value) onChange(sole.value);
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="atlas-model-search-clear"
                  aria-label={zh ? "清空搜索" : "Clear search"}
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="atlas-model-list" role="listbox" aria-label={ariaLabel}>
        {filteredItems.length === 0 ? (
          <div className="atlas-model-empty">
            <p>{query ? (zh ? `未找到匹配 “${query}” 的模型` : `No models matching "${query}"`) : (zh ? "暂无可选模型" : "No models available")}</p>
            {emptyAction ? (
              <button
                type="button"
                className="atlas-model-empty-action"
                disabled={emptyAction.loading}
                onClick={() => {
                  emptyAction.onClick();
                }}
              >
                <RefreshCw size={13} className={emptyAction.loading ? "spin" : undefined} aria-hidden="true" />
                <span>{emptyAction.label}</span>
              </button>
            ) : null}
          </div>
        ) : (
          groupedFiltered.map(([groupName, entries], groupIndex) => {
            const hasNamedGroup = Boolean(groupName);
            const content = entries.map((item) => {
              const selected = item.value === value;
              const badge = item.badge ?? inferModelBadge(item.subtitle ?? item.label, zh);
              return (
                <button
                  key={item.value || "__empty__"}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={item.ariaLabel}
                  tabIndex={-1}
                  className={`atlas-model-option${selected ? " is-selected" : ""}`}
                  title={item.subtitle ? `${item.label} · ${item.subtitle}` : item.label}
                  onClick={() => {
                    close(true);
                    if (item.value !== value) onChange(item.value);
                  }}
                >
                  <span className="atlas-model-option-main">
                    <span className="atlas-model-option-name">{item.label}</span>
                    {item.subtitle && item.subtitle !== item.label ? (
                      <span className="atlas-model-option-sub" aria-hidden="true">{item.subtitle}</span>
                    ) : null}
                  </span>
                  <span className="atlas-model-option-end" aria-hidden="true">
                    {badge ? <span className="atlas-model-tag">{badge}</span> : null}
                    {selected ? <Check size={14} className="atlas-model-check" /> : null}
                  </span>
                </button>
              );
            });
            return hasNamedGroup ? (
              <div key={groupName} className="atlas-model-group" role="group" aria-labelledby={`${popupId}-g-${groupIndex}`}>
                <div className="atlas-model-group-label" id={`${popupId}-g-${groupIndex}`}>
                  <span>{groupName}</span>
                  <small aria-hidden="true">{entries.length}</small>
                </div>
                {content}
              </div>
            ) : (
              <div key={`g-${groupIndex}`} className="atlas-model-group">{content}</div>
            );
          })
        )}
      </div>

      {emptyAction && filteredItems.length > 0 && items.length <= 2 ? (
        <div className="atlas-model-popover-foot">
          <button
            type="button"
            className="atlas-model-foot-btn"
            disabled={emptyAction.loading}
            onClick={() => {
              emptyAction.onClick();
            }}
          >
            <RefreshCw size={13} className={emptyAction.loading ? "spin" : undefined} aria-hidden="true" />
            <span>{emptyAction.label}</span>
          </button>
        </div>
      ) : null}

      {footerAction ? (
        <div className="atlas-model-popover-foot">
          <button
            type="button"
            className="atlas-model-foot-btn"
            onClick={() => {
              close(false);
              footerAction.onClick();
            }}
          >
            {footerAction.icon ?? <SlidersHorizontal size={13} aria-hidden="true" />}
            <span>{footerAction.label}</span>
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div className={`atlas-model-picker is-${variant}`} ref={rootRef}>
      {syncedSelect ? (
        <select
          id={syncedSelect.id || undefined}
          className="atlas-model-synced-select"
          aria-label={syncedSelect.id ? undefined : ariaLabel}
          tabIndex={-1}
          value={value}
          disabled={isBlocked}
          onChange={(event) => onChange(event.target.value)}
        >
          {syncedSelect.placeholderOption !== undefined ? (
            <option value="">{syncedSelect.placeholderOption}</option>
          ) : null}
          {syncedSelect.grouped && groupedAllForSelect.length > 1
            ? groupedAllForSelect.map(([groupName, entries]) => (
                <optgroup key={groupName} label={groupName}>
                  {entries.map((item) => (
                    <option key={item.value} value={item.value}>
                      {syncedSelect.optionText ? syncedSelect.optionText(item) : item.label}
                    </option>
                  ))}
                </optgroup>
              ))
            : items.map((item) => (
                <option key={item.value || "__empty__"} value={item.value}>
                  {syncedSelect.optionText ? syncedSelect.optionText(item) : item.label}
                </option>
              ))}
        </select>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        className={`atlas-model-trigger is-${variant}${open ? " is-open" : ""}${isEmptySelection ? " is-placeholder" : ""}`}
        aria-label={variant === "composer" ? `${ariaLabel} · ${ariaValue ?? triggerText}` : `${ariaLabel}：${ariaValue ?? triggerText}`}
        title={title ?? triggerText}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-disabled={isBlocked || undefined}
        disabled={variant === "settings" ? isBlocked : undefined}
        onClick={() => {
          if (isBlocked) return;
          setOpen((prev) => {
            if (prev) setQuery("");
            return !prev;
          });
        }}
        onKeyDown={(event) => {
          if (!isBlocked && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {variant === "composer" ? (
          <Sparkles size={13} className="atlas-model-trigger-icon" aria-hidden="true" />
        ) : (
          <Cpu size={14} className="atlas-model-trigger-icon" aria-hidden="true" />
        )}
        <span className="atlas-model-trigger-text">
          <span className="atlas-model-trigger-label">{triggerText}</span>
          {variant === "settings" && selectedItem?.subtitle && selectedItem.subtitle !== selectedItem.label ? (
            <span className="atlas-model-trigger-sub" aria-hidden="true">{selectedItem.subtitle}</span>
          ) : null}
        </span>
        <ChevronDown size={14} className="atlas-model-trigger-chevron" aria-hidden="true" />
      </button>

      {popoverNode ? (typeof document !== "undefined" ? createPortal(popoverNode, document.body) : popoverNode) : null}
    </div>
  );
}
