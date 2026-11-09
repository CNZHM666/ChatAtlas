import { useEffect, useId, useMemo, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useReaderToolbar } from "../hooks/useReaderToolbar";
import type { ConversationMessage } from "../../shared/types";
import { isInternalSearchQueryMessage } from "../../shared/conversation-text";
import { readerPosition, readerQuestionIndex } from "../reader-position";
import { ReaderConversation } from "./ReaderConversation";
import { readerScrollContainer as scrollContainer } from "../reader-scroll";

/** One reading control for original conversations, chapters and cited discussions.
 * The normal reader stays mounted while focused, preserving its loaded range. */
export function QuestionReader({ contextMessages, initialFocused = false, onQuestionChange, ...props }: Omit<ComponentProps<typeof ReaderConversation>, "focusOnly" | "hidden"> & { contextMessages?: ConversationMessage[]; initialFocused?: boolean; onQuestionChange?: (id: string) => void }) {
  const { messages, zh, focusMessageId, selectedQuestionId, focusNonce = 0 } = props;
  const root = useRef<HTMLDivElement>(null);
  const returnPosition = useRef<{ element: HTMLElement; top: number }>();
  const restore = useRef(false);
  const [focused, setFocused] = useState(initialFocused);
  const [contextOpen, setContextOpen] = useState(false);
  const [jump, setJump] = useState<{ key: string; id: string; nonce: number }>();
  const readable = useMemo(() => (contextOpen ? contextMessages ?? messages : messages).filter(message => !isInternalSearchQueryMessage(message)), [messages, contextMessages, contextOpen]);
  const index = useMemo(() => readerQuestionIndex(readable), [readable]);
  const questions = useMemo(() => readable.filter(message => message.role === "user"), [readable]);
  const toolbarId = useId();
  const toolbar = useReaderToolbar(toolbarId, root, Boolean(questions.length));
  const selectionKey = `${focusMessageId ?? ""}:${focusNonce}:${messages[0]?.conversationId ?? ""}`;
  const activeJump = jump?.key === selectionKey ? jump : undefined;
  const [selection, setSelection] = useState<{ key: string; id: string }>();
  const selected = selection?.key === selectionKey && index.has(selection.id) ? selection.id : index.get(focusMessageId ?? "") ?? selectedQuestionId ?? questions[0]?.id;
  const position = questions.findIndex(question => question.id === selected);
  const focusActive = focused && position >= 0;
  const fullContext = contextMessages ?? messages;
  const contextQuestions = fullContext.filter(message => message.role === "user" && !isInternalSearchQueryMessage(message));
  const contextPosition = contextQuestions.findIndex(question => question.id === selected);

  useEffect(() => {
    if (focused || !restore.current) return;
    restore.current = false;
    const frame = requestAnimationFrame(() => {
      if (returnPosition.current) returnPosition.current.element.scrollTop = returnPosition.current.top;
    });
    return () => cancelAnimationFrame(frame);
  }, [focused]);

  const enter = () => {
    const element = scrollContainer(root.current);
    if (element) returnPosition.current = { element, top: element.scrollTop };
    const wrappers = root.current?.querySelectorAll<HTMLElement>("[data-reader-message-id]");
    const boundary = (element?.getBoundingClientRect().top ?? 0) + 115;
    const visible = wrappers?.length ? readerPosition(wrappers.length, i => wrappers[i].getBoundingClientRect().top, boundary) : -1;
    const question = selectedQuestionId ?? (visible >= 0 ? index.get(wrappers?.[visible]?.dataset.readerMessageId ?? "") : undefined) ?? selected;
    if (!question) return;
    setSelection({ key: selectionKey, id: question }); onQuestionChange?.(question); setFocused(true);
  };
  const leave = () => {
    if (initialFocused && !returnPosition.current && selected) {
      // A citation starts directly in focus, so expanding the full discussion
      // should continue at the question now being read, not the initial cite.
      setJump(current => ({ key: selectionKey, id: selected, nonce: (current?.nonce ?? focusNonce) + 1 }));
    } else restore.current = true;
    setFocused(false);
  };
  const move = (id: string) => { setSelection({ key: selectionKey, id }); onQuestionChange?.(id); };
  const readContext = () => {
    const previous = contextQuestions[contextPosition - 1];
    if (!previous) return;
    restore.current = false; setContextOpen(true); setFocused(false);
    setJump(current => ({ key: selectionKey, id: previous.id, nonce: (current?.nonce ?? focusNonce) + 1 }));
    setSelection({ key: selectionKey, id: previous.id });
    onQuestionChange?.(previous.id);
  };
  const citedInTurn = focusMessageId && index.get(focusMessageId) === selected;
  const answerId = readable.find(message => message.role === "assistant" && index.get(message.id) === selected)?.id;
  const controls = questions.length ? <div className="question-reader-controls" role="group" aria-label={zh ? "问答阅读" : "Question reading"}>
      {focusActive ? <><span className="question-reader-pager"><button type="button" aria-label={zh ? "上一问" : "Previous question"} title={zh ? "上一问" : "Previous question"} disabled={position <= 0} onClick={() => move(questions[position - 1].id)}>{toolbar ? <ChevronLeft size={16} /> : zh ? "上一问" : "Previous question"}</button><span className="question-reader-position">{position + 1}/{questions.length}</span><button type="button" aria-label={zh ? "下一问" : "Next question"} title={zh ? "下一问" : "Next question"} disabled={position < 0 || position >= questions.length - 1} onClick={() => move(questions[position + 1].id)}>{toolbar ? <ChevronRight size={16} /> : zh ? "下一问" : "Next question"}</button></span>{contextPosition > 0 ? <button type="button" onClick={readContext}>{zh ? "查看前文" : "Read earlier context"}</button> : null}</> : null}
      <button type="button" className="source-focus-toggle" aria-pressed={focusActive} onClick={focusActive ? leave : enter}>{zh ? focusActive ? "退出专注" : "专注回答" : focusActive ? "Exit focus" : "Focus question"}</button>
    </div> : null;
  return <div className="question-reader" ref={root}>
    {toolbar ? toolbar.host && toolbar.active === toolbarId ? createPortal(controls, toolbar.host) : null : controls}
    <ReaderConversation {...props} messages={readable} hidden={focusActive} focusMessageId={activeJump?.id ?? focusMessageId} focusNonce={activeJump?.nonce ?? focusNonce} focusPlacement={activeJump ? "question" : props.focusPlacement} />
    {focusActive ? <ReaderConversation {...props} messages={readable} focusOnly selectedQuestionId={selected} focusMessageId={citedInTurn ? focusMessageId : answerId ?? selected} focusExcerpt={citedInTurn ? props.focusExcerpt : undefined} focusRange={citedInTurn ? props.focusRange : undefined} focusNonce={focusNonce} focusPlacement={props.focusPlacement ?? "question"} /> : null}
  </div>;
}
