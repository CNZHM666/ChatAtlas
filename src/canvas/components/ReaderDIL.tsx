import { Fragment, useMemo, useState, type ReactNode } from "react";
import { dilDocument, type DILNode } from "../../shared/dil-document";
import { dilValue } from "../../shared/dil-values";
import { ReaderImage } from "./ReaderImage";

/** Local data/controls, interpreted from a fixed vocabulary. Source scripts never run in the extension. */
export function ReaderDIL({ source, zh }: { source: string; zh: boolean }) {
  const model = useMemo(() => dilDocument(source), [source]);
  const [state, setState] = useState<Record<string, unknown>>({});
  const [copied, setCopied] = useState(false);
  if (!model.supported) return null;
  const scope = Object.assign(Object.create(null) as Record<string, unknown>, model.scope, state);
  const text = (value: unknown) => value === undefined || value === null ? "…" : typeof value === "object" ? "" : String(value);
  const update = (setter: string, value: unknown) => {
    const name = model.setters[setter]; if (!name || value === undefined) return;
    setState(previous => ({ ...previous, [name]: value }));
  };
  const handler = (raw: string | undefined, local: Record<string, unknown>): ((value?: unknown) => void) | undefined => {
    if (!raw) return;
    const expression = raw.replace(/\s+/gu, "");
    if (Object.hasOwn(model.setters, expression)) return value => update(expression, value);
    const call = /^(?:\(\)|([\w$]+))=>([\w$]+)\((.*)\)$/u.exec(expression);
    if (call && Object.hasOwn(model.setters, call[2])) {
      const toggle = /^([\w$]+)=>([\w$]+)\?\[\.\.\.\1,([\w$.]+)\]:\1\.filter\(([\w$]+)=>\4!==\3\)$/u.exec(call[3]);
      if (toggle && toggle[2] === call[1] && Array.isArray(local[model.setters[call[2]]])) return checked => {
        const item = dilValue(toggle[3], local), current = local[model.setters[call[2]]] as unknown[];
        if (item !== undefined) update(call[2], checked ? [...new Set([...current, item])] : current.filter(value => value !== item));
      };
      // Recognize only complete supported assignments; an unknown action stays disabled.
      const testScope = { ...local, ...(call[1] ? { [call[1]]: "" } : {}) };
      if (dilValue(call[3], testScope) !== undefined) return value => update(call[2], dilValue(call[3], { ...local, ...(call[1] ? { [call[1]]: value } : {}) }));
    }
    const copy = /^\(\)=>(?:DIL|GenUI)\.copy\(([\s\S]*)\)$/u.exec(raw.replace(/^\s+|\s+$/gu, ""));
    if (copy && typeof dilValue(copy[1], local) === "string") return () => {
      void navigator.clipboard?.writeText(String(dilValue(copy[1], local))).then(() => setCopied(true)).catch(() => undefined);
    };
  };
  let rendered = 0;
  const render = (nodes: DILNode[], local: Record<string, unknown>, prefix = ""): ReactNode => nodes.map((node, index) => {
    if (++rendered > 2000) return null;
    const key = `${prefix}${index}`;
    if (node.kind === "text") return node.value;
    if (node.kind === "expression") return text(dilValue(node.value, local));
    if (node.kind === "if") {
      const value = dilValue(node.value, local);
      return <Fragment key={key}>{value === undefined ? <small>{zh ? "条件数据未保存" : "Conditional data unavailable"}</small> : render(value ? node.children : node.alternate ?? [], local, key)}</Fragment>;
    }
    if (node.kind === "each") {
      const match = /^(.+?)\s+as\s+([\w$]+)(?:\s*,\s*([\w$]+))?(?:\s+\([^)]*\))?$/u.exec(node.value);
      const items = match ? dilValue(match[1], local) : undefined;
      return <Fragment key={key}>{Array.isArray(items) && match ? items.slice(0, 100).map((item, i) => <Fragment key={i}>{render(node.children, { ...local, [match[2]]: item, ...(match[3] ? { [match[3]]: i } : {}) }, `${key}-${i}-`)}</Fragment>) : <small>{zh ? "列表数据未保存" : "List data unavailable"}</small>}</Fragment>;
    }
    const attr = (name: string) => { const item = node.attributes?.[name]; return item ? item.expression ? dilValue(item.value, local) : item.value : undefined; };
    const children = render(node.children, local, `${key}-`), label = typeof attr("label") === "string" ? String(attr("label")) : undefined;
    const change = handler(node.attributes?.onChange?.value, local), click = handler(node.attributes?.onClick?.value, local);
    const disabled = Boolean(attr("disabled"));
    const unavailable = zh ? "此操作依赖未保存的组件逻辑，请在原平台使用" : "This action requires unavailable logic; use the original platform";
    const options = attr("options") ?? attr("items");
    const choices = Array.isArray(options) ? options.slice(0, 100).map(option => typeof option === "string" || typeof option === "number" ? { value: String(option), label: String(option) } : option && typeof option === "object" ? { value: String(option.value ?? option.id ?? ""), label: String(option.label ?? option.title ?? option.name ?? option.value ?? option.id ?? "") } : undefined).filter((option): option is { value: string; label: string } => Boolean(option)) : [];
    switch (node.value) {
      case "title": return <h3 key={key}>{children}</h3>;
      case "caption": return <small key={key}>{children}</small>;
      case "divider": return <hr key={key} />;
      case "spacer": return <span key={key} className="reader-dil-spacer" />;
      case "AsyncImage": return <ReaderImage key={key} src={typeof attr("src") === "string" ? String(attr("src")) : undefined} alt={typeof attr("alt") === "string" ? String(attr("alt")) : label} zh={zh} />;
      case "button": case "pressable": return <button key={key} type="button" disabled={disabled || !click} title={!click ? unavailable : undefined} onClick={() => click?.()}>{children || label}</button>;
      case "checkbox": return <label key={key} className="reader-dil-control"><input type="checkbox" checked={Boolean(attr("checked"))} disabled={disabled || !change} title={!change ? unavailable : undefined} onChange={event => change?.(event.target.checked)} />{children || label}</label>;
      case "slider": return <label key={key} className="reader-dil-control">{label}<input type="range" min={Number(attr("min") ?? 0)} max={Number(attr("max") ?? 100)} step={Number(attr("step") ?? 1)} value={Number(attr("value") ?? 0)} disabled={disabled || !change} onChange={event => change?.(Number(event.target.value))} /><output>{text(attr("value"))}</output></label>;
      case "segmented-control": case "radio-group": return <div key={key} className="reader-dil-choices" role="group" aria-label={label}>{label ? <small>{label}</small> : null}{choices.length ? choices.map(choice => <button key={choice.value} type="button" aria-pressed={String(attr("value")) === choice.value} disabled={disabled || !change} onClick={() => change?.(choice.value)}>{choice.label}</button>) : <span>{text(attr("value"))}</span>}</div>;
      case "select": return <label key={key} className="reader-dil-control">{label}<select value={String(attr("value") ?? "")} disabled={disabled || !change || !choices.length} onChange={event => change?.(event.target.value)}>{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>;
      case "input": case "textarea": {
        const props = { value: String(attr("value") ?? ""), placeholder: typeof attr("placeholder") === "string" ? String(attr("placeholder")) : undefined, disabled: disabled || !change, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change?.(event.target.value) };
        return <label key={key} className="reader-dil-control">{label}{node.value === "textarea" ? <textarea {...props} /> : <input {...props} />}</label>;
      }
      case "Link": case "Cite": {
        const href = attr("href"); return typeof href === "string" && /^https?:\/\//iu.test(href) ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{children || label}</a> : <span key={key}>{children || label}</span>;
      }
      case "icon": return null;
      default: return <div key={key} className={`reader-dil-node reader-dil-${node.value.toLowerCase()}`}>{children || label}</div>;
    }
  });
  return <div className="reader-dil-live">{render(model.nodes, scope)}{copied ? <small role="status">{zh ? "已复制" : "Copied"}</small> : null}<small className="reader-dil-local-note">{zh ? "本地交互 · 更改仅用于本次阅读，部分操作需回原平台" : "Local controls · Changes last for this reading; some actions require the original platform"}</small></div>;
}
