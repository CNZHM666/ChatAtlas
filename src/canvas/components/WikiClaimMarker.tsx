import { useContext } from "react";
import { WikiClaimMarkerContext } from "../wiki-claim-marker-context";
import { wikiHolderLabel, wikiHolderTitle, wikiShownHolder, wikiUnmarkedHolder } from "../../shared/wiki-holder";

/** Inline evidence marker after a claim sentence. A claim that knows its holder shows it: the last claim of a run of
 * one holder is labelled (已定, 你, 资料, AI) and covers the text back to the previous mark; the others in the run are
 * dots. Without a holder the number comes from a CSS counter, so it matches reading order and the panel's position. */
export function WikiClaimMarker({ pointKey }: { pointKey: string }) {
  const context = useContext(WikiClaimMarkerContext);
  const point = context?.points.find(item => item.key === pointKey);
  if (!context || !point) return null;
  const { zh } = context, label = point.label ?? (zh ? "整理记录" : "Organized record");
  // A run ending names its status; the assistant's text, the default, and the points inside a run stay quiet dots.
  const holder = point.holder && wikiShownHolder(point.holder, point.claim), labelled = Boolean(holder && point.holderMark && !wikiUnmarkedHolder(holder));
  const text = holder ? `${wikiHolderTitle(holder, zh)} · ${zh ? "核对依据" : "Check evidence"}` : zh ? `核对依据：${label}` : `Check evidence: ${label}`;
  const classes = ["wiki-claim-marker", `is-${point.source}`, holder ? `is-holder is-holder-${holder}${labelled ? " is-holder-mark" : " is-holder-quiet"}` : "", point.approximate ? "is-approximate" : "", context.activeKey === pointKey ? "is-active" : ""].filter(Boolean).join(" ");
  return <button type="button" className={classes} data-claim-key={pointKey} aria-label={text} title={text} aria-current={context.activeKey === pointKey || undefined} onClick={event => { event.preventDefault(); context.open(pointKey); }}>{holder && labelled ? <span aria-hidden="true">{wikiHolderLabel(holder, zh)}</span> : null}</button>;
}
