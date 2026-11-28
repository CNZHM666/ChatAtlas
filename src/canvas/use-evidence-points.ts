import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FocusEvidence } from "../shared/focus-session";
import type { WikiClaimMarkerPoint } from "../shared/wiki-claim-markers";
import { WorkspaceEvidenceContext, needsConfirmation, type EvidencePoint } from "./workspace-evidence-context";
import { paintClaimHighlights, revealRange, similarSentenceRanges } from "./claim-highlight";

/** Point-by-point evidence for one page: prose markers are read back in rendered
 * order (CSS numbers them the same way), the panel steps through that order, and
 * points with no position follow. `renderKey` changes whenever the prose re-renders. */
export function useEvidencePoints(points: Array<EvidencePoint & { phrases: string[] }>, onLocate: (ref: FocusEvidence) => void, zh: boolean, renderKey: unknown, pending?:EvidencePoint[]) {
  const evidencePanel = useContext(WorkspaceEvidenceContext);
  const rootRef = useRef<HTMLElement>(null);
  const claimMarkers = useMemo<WikiClaimMarkerPoint[]>(() => points.map(({ key, phrases, approximate }) => ({ key, phrases, approximate })), [points]);
  const [placedKeys, setPlacedKeys] = useState<string[]>([]);
  // Extra phrase data rides along; the panel reads only EvidencePoint fields.
  const answers=evidencePanel?.active?.points;
  const ordered = useMemo<EvidencePoint[]>(() => {
    const basis=new Map(points.map(point=>[point.key,point]));
    const awaiting=pending&&new Map(pending.map(point=>[point.key,point.attention]));
    const answered=new Map(answers?.filter(point=>point.checked).map(point=>[point.key,point]));
    const display=(point:EvidencePoint,placed=point.placed)=>{
      const answer=answered.get(point.key);
      return {...point,...(answer?{holder:answer.holder,holderMark:answer.holderMark,checked:true}:{}),
        attention:awaiting?awaiting.get(point.key):point.attention,placed};
    };
    const result=placedKeys.flatMap(key=>{const point=basis.get(key);basis.delete(key);return point?[display(point,true)]:[];});
    return [...result,...[...basis.values()].map(point=>display(point))];
  }, [points, placedKeys,pending,answers]);
  // A marker opens its point. One that needs the reader's answer opens among the others that do, to step through;
  // any other opens alone: its original was found, and stepping through every sentence (42 of 69) asked for nothing.
  const open = useCallback((key: string) => {
    const point = ordered.find(item => item.key === key);
    if (!point) return;
    const queue = needsConfirmation(point) ? ordered.filter(needsConfirmation) : [point];
    if (evidencePanel) evidencePanel.open(point.reference, { references: point.references, quote: point.quote, claim: point.claim, points: queue, pointIndex: queue.indexOf(point),...(pending&&needsConfirmation(point)?{mode:"check"}:{}) });
    else onLocate(point.reference);
  }, [ordered, evidencePanel, onLocate,pending]);
  const active = evidencePanel?.active, activePoint = active?.points?.[active.pointIndex ?? -1], activeKey = activePoint?.key;
  const reviewExcerpt = active?.mode === "check" ? activePoint?.attention?.claimExcerpt : undefined;
  useEffect(() => {
    const keys = [...rootRef.current?.querySelectorAll<HTMLElement>("[data-claim-key]") ?? []].map(node => node.dataset.claimKey!);
    setPlacedKeys(current => current.length === keys.length && current.every((key, index) => key === keys[index]) ? current : keys);
  }, [renderKey, claimMarkers]);
  // Stepping in the panel brings the matching marker into view.
  useEffect(() => {
    if (!activeKey) return;
    const marker = [...rootRef.current?.querySelectorAll<HTMLElement>("[data-claim-key]") ?? []].find(node => node.dataset.claimKey === activeKey);
    // A marker inside a collapsed card (evolution history) opens it first.
    const details = marker?.closest("details");
    if (details && !details.open) details.open = true;
  }, [activeKey]);
  // Left the claim, right its origin: the claim being checked, or every claim citing the original shown, is highlighted.
  const shown = active?.tableTarget || active?.structuredBlock || active?.overviewEntryId ? undefined : active?.shown;
  const selectedClaim = shown ? active?.claim : undefined;
  const highlighted = useMemo(() => activeKey ? [activeKey] : shown ? ordered.filter(point =>
    (!selectedClaim || point.claim === selectedClaim) && point.references.some(ref => ref.id === shown.id || ref.conversationId === shown.conversationId && ref.messageId === shown.messageId)).map(point => point.key) : [], [activeKey, shown, ordered, selectedClaim]);
  const highlightKey = highlighted.join("|");
  useLayoutEffect(() => {
    const root = rootRef.current;
    let ranges = paintClaimHighlights(root, highlightKey ? highlightKey.split("|") : [], key => {
      const point = points.find(item => item.key === key);
      return point ? [...(key === activeKey && reviewExcerpt ? [reviewExcerpt] : []), point.claim, ...point.phrases] : [];
    });
    // Prose written in its own words (an overview) has no marker for the original: its closest sentences are marked.
    // A point whose marker and wording are not found (reworded prose, emphasis inside it) gets its closest sentences.
    if (!ranges.length) {
      const wanted = highlightKey ? points.filter(point => highlightKey.split("|").includes(point.key)) : [];
      // Each claim owns its numeric conditions. Different points citing the
      // same source must not inherit the first point's count or bound.
      const queries=wanted.length?wanted.map(point=>[point.claim,...point.phrases]):selectedClaim?[[selectedClaim]]:!activeKey&&shown?.excerpt?[[shown.excerpt]]:[];
      ranges = paintClaimHighlights(root, [], () => [], queries.slice(0,6).flatMap(texts=>similarSentenceRanges(root,texts,1)));
    }
    // Each switch brings the highlighted text into view inside the document's own scroll area. Opening the panel
    // restores the reading position on the next frame (the layout narrows), so the reveal runs just after that.
    const first = ranges[0];
    const timer = first ? window.setTimeout(() => revealRange(first), 120) : undefined;
    return () => { window.clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- points change with the prose, which renderKey tracks.
  }, [highlightKey, activeKey, active?.locationRevision, renderKey, shown?.id, selectedClaim, reviewExcerpt]);
  useEffect(() => () => { paintClaimHighlights(rootRef.current, []); }, []);
  const pointByKey = useMemo(() => new Map(ordered.map(point => [point.key, point])), [ordered]);
  const markerContext = useMemo(() => ({ points: ordered, pointByKey, activeKey, open, zh }), [ordered, pointByKey, activeKey, open, zh]);
  return { rootRef, claimMarkers: claimMarkers.length ? claimMarkers : undefined, ordered, open, markerContext };
}
