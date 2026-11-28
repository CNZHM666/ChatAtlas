import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FocusEvidence, FocusSession } from "../shared/focus-session";
import { continuationContext } from "../shared/project-continuation";
import { architectureChapter } from "./project";

export function ContinuationDemo({ session, zh, onClose, onEvidence }: {
  session: FocusSession; zh: boolean; onClose: () => void; onEvidence: (reference: FocusEvidence) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"start" | "handoff" | "review" | "saved">("start");
  const t = (cn: string, en: string) => zh ? cn : en;
  const reference = session.evidence.find(item => item.messageId === "architecture-2");
  const first = { ...session, goal: t("为初学者提供 ESP32 方案预览和基础校验。", "Give beginners an ESP32 plan preview and basic validation."),
    sections: session.sections.filter(item => item.id === "release-scope") };
  const entry = session.sections.find(item => item.id === architectureChapter)?.claims?.find(claim => reference && claim.evidenceIds.includes(reference.id));
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return <dialog className="demo-continuation" ref={dialog} aria-labelledby="demo-continuation-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header>
      <strong id="demo-continuation-title">{t("跨 AI 续写演示", "Cross-AI continuation demo")}</strong>
      <button type="button" className="icon-button" onClick={onClose} aria-label={t("关闭", "Close")}><X size={17}/></button>
    </header>
    <div className="demo-continuation-inner">
      <small>{step === "start" ? "ChatGPT" : step === "handoff" ? "ChatGPT → Claude" : "Claude"} · {t("示例对话", "Sample conversation")}</small>
      <h2>{step === "start" ? t("创建项目", "Create a project") : session.title}</h2>
      {step === "start" && <p>{session.title} · {first.goal}</p>}
      {step === "handoff" && <textarea rows={7} aria-label={t("带入 Claude 的上下文", "Context for Claude")} value={continuationContext(first, zh)} readOnly/>}
      {step === "review" && <section><h3>{t("本轮新增", "New in this chat")}</h3><p>{entry?.text}</p>
        <details><summary>{t("Claude 原话", "Quote from Claude")}</summary><blockquote>{reference?.excerpt}</blockquote></details>
      </section>}
      {step === "saved" && <section><h3>{t("已写入项目决定", "Decision added")}</h3><p>{entry?.text}</p></section>}
      <footer>
        {step === "start" && <button type="button" className="primary" onClick={() => setStep("handoff")}>{t("创建并查看首版", "Create and view first version")}</button>}
        {step === "handoff" && <button type="button" className="primary" onClick={() => setStep("review")}>{t("在 Claude 继续", "Continue in Claude")}</button>}
        {step === "review" && <button type="button" className="primary" onClick={() => setStep("saved")}>{t("确认并写入", "Confirm and apply")}</button>}
        {step === "saved" && reference && <button type="button" className="primary" onClick={() => onEvidence(reference)}>{t("在 Wiki 核对原话", "Check the quote in the wiki")}<ArrowUpRight size={15}/></button>}
      </footer>
    </div>
  </dialog>;
}
