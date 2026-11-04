import { ArrowDown, ArrowUp } from "lucide-react";
import { WorkspaceBackButton } from "./WorkspaceBackButton";
import { useState } from "react";
import type { CanvasCard } from "../../shared/types";
import { usePreferences } from "../preferences";

export function ReadingPathEditor({ cards, initialPath, onClose, onSave }: {
  cards: CanvasCard[];
  initialPath: string[];
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [path, setPath] = useState(() => {
    const readable = cards.filter((card) => card.kind !== "conversation" && card.kind !== "portal");
    const byId = new Map(readable.map((card) => [card.id, card]));
    const saved = initialPath.filter((id) => byId.has(id));
    const missing = readable.filter((card) => !saved.includes(card.id)).sort((a, b) => a.y - b.y || a.x - b.x).map((card) => card.id);
    return [...saved, ...missing];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const byId = new Map(cards.map((card) => [card.id, card]));
  const move = (index: number, offset: number) => setPath((current) => {
    const next = [...current];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    return next;
  });
  const save = async () => {
    setSaving(true); setError("");
    try { await onSave(path); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSaving(false); }
  };
  return <main className="reading-path-editor" aria-label={zh ? "调整复习路线" : "Edit review path"}>
    <WorkspaceBackButton className="reading-path-editor-back" onClick={onClose} label={zh ? "返回阅读" : "Back to reader"} />
    <div className="reading-path-editor-content">
      <h1>{zh ? "复习路线" : "Review path"}</h1>
      <p>{zh ? "调整知识的阅读顺序。保存后，AI 整理会保留你的顺序。" : "Arrange the reading order. Future AI organization will keep your order."}</p>
      <ol>{path.map((id, index) => <li key={id}>
        <span className="reading-path-editor-number">{String(index + 1).padStart(2, "0")}</span>
        <span className="reading-path-editor-title">{byId.get(id)?.title ?? id}</span>
        <button type="button" disabled={index === 0 || saving} onClick={() => move(index, -1)} aria-label={`${zh ? "上移" : "Move up"} ${byId.get(id)?.title ?? id}`}><ArrowUp size={16} /></button>
        <button type="button" disabled={index === path.length - 1 || saving} onClick={() => move(index, 1)} aria-label={`${zh ? "下移" : "Move down"} ${byId.get(id)?.title ?? id}`}><ArrowDown size={16} /></button>
      </li>)}</ol>
      {error ? <p role="alert" className="reading-path-editor-error">{error}</p> : null}
      <button className="primary" disabled={saving || path.length < 2} onClick={() => void save()}>{saving ? zh ? "保存中…" : "Saving…" : zh ? "保存路线" : "Save path"}</button>
    </div>
  </main>;
}
