import { useContext } from "react";
import { WikiClaimMarkerContext } from "../wiki-claim-marker-context";
import { wikiHolderReadingLabel, wikiHolderTitle, wikiUnmarkedHolder } from "../../shared/wiki-holder";

/** Inline evidence marker after a claim sentence. A claim that knows its holder shows it: the last claim of a run of
 * one holder is labelled (已定, 你, 资料, AI) and covers the text back to the previous mark; the others in the run are
 * dots. Without a holder the number comes from a CSS counter, so it matches reading order and the panel's position. */
export function WikiClaimMarker({ pointKey, flowSource = false }: { pointKey: string; flowSource?: boolean }) {
  const context = useContext(WikiClaimMarkerContext);
  const point = context?.pointByKey ? context.pointByKey.get(pointKey) : context?.points.find(item => item.key === pointKey);
  if (!context || !point) return null;
  const { zh } = context, label = point.label ?? (zh ? "整理记录" : "Organized record");
  // Core status pills (Decided / Open / Earlier plan) and AI suggestion when holder marks are revealed.
  const holder = point.holder;
  const showAiLabel = holder === "ai" && !wikiUnmarkedHolder(holder);
  const labelled = Boolean(holder && (point.holderMark && !wikiUnmarkedHolder(holder) || showAiLabel || holder === "ai"));
  const reported = holder === "user" && point.source === "report";
  const basis = reported ? (zh ? "用户报告，代码或测试尚未核验" : "User report, code or tests unverified") : holder && wikiHolderTitle(holder, zh);
  const text = basis ? `${basis} · ${zh ? "核对依据" : "Check evidence"}` : zh ? `核对依据：${label}` : `Check evidence: ${label}`;
  const isAiPill = holder === "ai";
  const classes = ["wiki-claim-marker", `is-${point.source}`, flowSource ? "is-flow-source" : holder ? `is-holder is-holder-${holder}${labelled ? (isAiPill ? " is-holder-mark is-holder-ai-pill" : " is-holder-mark") : " is-holder-quiet"}` : "", point.approximate ? "is-approximate" : "", context.activeKey === pointKey ? "is-active" : ""].filter(Boolean).join(" ");
  return <button type="button" className={classes} data-claim-key={pointKey} aria-label={text} title={text} aria-current={context.activeKey === pointKey || undefined} onClick={event => { event.preventDefault(); context.open(pointKey); }}>{flowSource ? (zh ? "来源" : "Source") : holder && labelled ? <span aria-hidden="true">{wikiHolderReadingLabel(holder, zh, reported, context.learning)}</span> : null}</button>;
}
