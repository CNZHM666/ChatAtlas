import { useLayoutEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { FocusEvidence } from "../../shared/focus-session";
import { wikiHolderReadingLabel, wikiHolderTitle } from "../../shared/wiki-holder";
import { paintHolderRuns } from "../claim-highlight";
import { wikiStatusGroups } from "../wiki-evidence";
import type { EvidencePoint } from "../workspace-evidence-context";

export function WikiSourceCards({ host, navigation, body, points, references, zh, activeKey, activeOriginalId, onSelect, onOriginal }: {
  host: HTMLElement; navigation?: HTMLElement | null; body: RefObject<HTMLElement>; points: Array<EvidencePoint & { phrases: string[] }>;
  references: FocusEvidence[]; zh: boolean; activeKey?: string; activeOriginalId?: string;
  onSelect: (point: EvidencePoint, navigate?: boolean) => void; onOriginal: (ref: FocusEvidence) => void;
}) {
  useLayoutEffect(() => {
    const prose = body.current;
    const phrases = new Map(points.map(point => [point.key, point.phrases]));
    paintHolderRuns(prose, true, key => phrases.get(key) ?? []);
    return () => { paintHolderRuns(prose, false); };
  }, [body, points]);

  const groups = wikiStatusGroups(points).map(({ holder, reported, points }) => ({
    id: `${holder}:${reported}`, className: `is-holder-${holder}${reported ? " is-report" : ""}`,
    label: wikiHolderReadingLabel(holder, zh, reported),
    title: reported ? (zh ? "用户报告，代码或测试尚未核验" : "User report, code or tests unverified") : wikiHolderTitle(holder, zh), points,
  }));
  const unclassified = points.filter(point => !point.holder);
  if (unclassified.length) groups.push({ id: "excerpt", className: "is-source-excerpt",
    label: zh ? "原话摘录" : "Original excerpts", title: zh ? "查看关联的原话" : "View related excerpts", points: unclassified });
  const chapterOrder = (members: EvidencePoint[]) => {
    const markerOrder = new Map(Array.from(body.current?.querySelectorAll<HTMLElement>("[data-claim-key]") ?? [])
      .map((marker, index) => [marker.dataset.claimKey, index]));
    return [...members].sort((a, b) => (markerOrder.get(a.key) ?? markerOrder.size) - (markerOrder.get(b.key) ?? markerOrder.size));
  };
  const firstVisible = (members: EvidencePoint[]) => {
    const prose = body.current;
    const top = prose?.getBoundingClientRect().top ?? 0;
    const nearby = Array.from(prose?.querySelectorAll<HTMLElement>("[data-claim-key]") ?? []).find(marker =>
      marker.getBoundingClientRect().bottom > top && members.some(point => marker.dataset.claimKey === point.key));
    return members.find(item => item.key === nearby?.dataset.claimKey) ?? members[0];
  };
  const group = groups.find(item => item.points.some(point => point.key === activeKey));
  const activeGroup = group ? chapterOrder(group.points) : [];
  const position = group ? activeGroup.findIndex(point => point.key === activeKey) : references.findIndex(ref => ref.id === activeOriginalId);
  const total = group ? activeGroup.length : references.length;
  const goTo = (index: number) => group ? onSelect(activeGroup[index], true) : onOriginal(references[index]);

  return <>{createPortal(<div className="wiki-status-panel" role="group" aria-label={zh ? "按状态查阅依据" : "Find evidence by status"}>
    {groups.map(group => <button type="button" key={group.id} className={`wiki-status-key ${group.className}`}
      aria-pressed={group.points.some(point => point.key === activeKey)} title={group.title}
      onClick={() => {
        const ordered = chapterOrder(group.points);
        const current = ordered.findIndex(point => point.key === activeKey);
        onSelect(current < 0 ? firstVisible(ordered) : ordered[current], true);
      }}>{group.label} <span>{group.points.length}</span></button>)}
    {!groups.length && references.length > 0 && <button type="button" className="wiki-status-key is-source-excerpt"
      onClick={() => onOriginal(references[Math.max(0, position)])}>{zh ? "原话摘录" : "Original excerpts"} <span>{references.length}</span></button>}
  </div>, host)}
  {navigation && position >= 0 && createPortal(<div role="group" aria-label={zh ? "切换出处" : "Browse sources"}>
    <button type="button" className="sidecar-wiki-action" disabled={position === 0} aria-label={zh ? "上一处" : "Previous source"}
      onClick={() => goTo(position - 1)}><ChevronLeft size={15} aria-hidden="true"/></button>
    <output aria-live="polite">{position + 1} / {total}</output>
    <button type="button" className="sidecar-wiki-action" disabled={position === total - 1} aria-label={zh ? "下一处" : "Next source"}
      onClick={() => goTo(position + 1)}><ChevronRight size={15} aria-hidden="true"/></button>
  </div>, navigation)}</>;
}
