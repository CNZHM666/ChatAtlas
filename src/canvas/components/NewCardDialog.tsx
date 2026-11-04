import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../preferences";

interface NewCardDialogProps {
  onClose: () => void;
  onCreate: (title: string, content: string) => void;
}

export function NewCardDialog({ onClose, onCreate }: NewCardDialogProps) {
  const { t } = usePreferences();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="new-card-dialog" onSubmit={(event) => { event.preventDefault(); if (title.trim()) onCreate(title.trim(), content.trim()); }}>
        <span className="eyebrow">{t("newCard")}</span>
        <h2>{t("giveIdeaHome")}</h2>
        <p className="new-card-hint">{t("newCardHint")}</p>
        <label>{t("title")}<input ref={input} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("titleExample")} /></label>
        <label>{t("cardContent")} <span>{t("optional")}</span><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder={t("descriptionExample")} rows={3} /></label>
        <div className="dialog-actions"><button type="button" onClick={onClose}>{t("cancel")}</button><button className="primary-action" disabled={!title.trim()}>{t("createCard")}</button></div>
      </form>
    </div>
  );
}
