import { BookOpenText, PenLine, Sparkles } from "lucide-react";
import type { Conversation } from "../../shared/types";
import { usePreferences } from "../preferences";

export function ConversationStart({ conversation, onManual, onAI, onRead }: {
  conversation: Conversation;
  onManual: () => void;
  onAI?: () => void;
  onRead: () => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  return <section className="conversation-start" aria-label={zh ? "选择对话整理方式" : "Choose how to organize this conversation"}>
    <div className="conversation-start-inner">
      <h1 title={conversation.title}>{conversation.title}</h1>
      <p>{zh ? "整理在工作台完成，原始对话保留当时的讨论顺序。" : "Organize on the Workbench. Originals retain the discussion order."}</p>
      <button type="button" className="conversation-start-read primary" onClick={onRead}><BookOpenText size={16} />{zh ? "阅读原对话" : "Read conversation"}</button>
      <div className="conversation-start-options">
        <button type="button" className="conversation-start-option" onClick={onManual}>
          <span className="conversation-start-icon"><PenLine size={21} /></span>
          <strong>{zh ? "自己整理" : "Organize myself"}</strong>
        </button>
        {onAI ? <button type="button" className="conversation-start-option is-ai" onClick={onAI}>
          <span className="conversation-start-icon"><Sparkles size={21} /></span>
          <strong>{zh ? "在工作台整理" : "Organize on Workbench"}</strong>
        </button> : null}
      </div>
    </div>
  </section>;
}
