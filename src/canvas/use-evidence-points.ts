import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvidence } from "../shared/focus-session";
import type { WikiClaimMarkerPoint } from "../shared/wiki-claim-markers";
import { WorkspaceEvidenceContext, needsConfirmation, type EvidencePoint } from "./workspace-evidence-context";
import { paintClaimHighlights, revealRange, similarSentenceRanges } from "./claim-highlight";

/** Point-by-point evidence for one page: prose markers are read back in rendered
 * order (CSS numbers them the same way), the panel steps through that order, and
 * points with no position follow. `renderKey` changes whenever the prose re-renders. */
export function useEvidencePoints(points: Array<EvidencePoint & { phrases: string[] }>, onLocate: (ref: FocusEvidence) => void, zh: boolean, renderKey: unknown) {
  const evidencePanel = useContext(WorkspaceEvidenceContext);
  const rootRef = useRef<HTMLElement>(null);
  const claimMarkers = useMemo<WikiClaimMarkerPoint[]>(() => points.map(({ key, phrases }) => ({ key, phrases })), [points]);
  const [placedKeys, setPlacedKeys] = useState<string[]>([]);
  // Extra phrase data rides along; the panel reads only EvidencePoint fields.
  const ordered = useMemo<EvidencePoint[]>(() => [
    ...placedKeys.flatMap(key => points.filter(point => point.key === key).map(point => ({ ...point, placed: true }))),
    ...points.filter(point => !placedKeys.includes(point.key)),
  ], [points, placedKeys]);
  // A marker opens its point. One that needs the reader's answer opens among the others that do, to step through;
  // any other opens alone: its original was found, and stepping through every sentence (42 of 69) asked for nothing.
  const open = useCallback((key: string) => {
    const point = ordered.find(item => item.key === key);
    if (!point) return;
    const queue = needsConfirmation(point) ? ordered.filter(needsConfirmation) : [point];
    if (evidencePanel) evidencePanel.open(point.reference, { references: point.references, quote: point.quote, claim: point.claim, points: queue, pointIndex: queue.indexOf(point) });
    else onLocate(point.reference);
  }, [ordered, evidencePanel, onLocate]);
  const active = evidencePanel?.active, activeKey = active?.points?.[active.pointIndex ?? -1]?.key;
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
  const shown = active?.shown;
  const highlighted = useMemo(() => activeKey ? [activeKey] : shown ? ordered.filter(point => point.references.some(ref => ref.id === shown.id || ref.conversationId === shown.conversationId && ref.messageId === shown.messageId)).map(point => point.key) : [], [activeKey, shown, ordered]);
  const highlightKey = highlighted.join("|");
  useEffect(() => {
    const root = rootRef.current;
    let ranges = paintClaimHighlights(root, highlightKey ? highlightKey.split("|") : [], key => { const point = points.find(point => point.key === key); return point ? [point.claim, ...point.phrases] : []; });
    // Prose written in its own words (an overview) has no marker for the original: its closest sentences are marked.
    // A point whose marker and wording are not found (reworded prose, emphasis inside it) gets its closest sentences.
    if (!ranges.length) {
      const wanted = highlightKey ? points.filter(point => highlightKey.split("|").includes(point.key)) : [];
      // Each claim owns its numeric conditions. Different points citing the
      // same source must not inherit the first point's count or bound.
      const queries=wanted.length?wanted.map(point=>[point.claim,...point.phrases]):!activeKey&&shown?.excerpt?[[shown.excerpt]]:[];
      ranges = paintClaimHighlights(root, [], () => [], queries.slice(0,6).flatMap(texts=>similarSentenceRanges(root,texts,1)));
    }
    // Each switch brings the highlighted text into view inside the document's own scroll area. Opening the panel
    // restores the reading position on the next frame (the layout narrows), so the reveal runs just after that.
    const first = ranges[0];
    const timer = first ? window.setTimeout(() => revealRange(first), 120) : undefined;
    return () => { window.clearTimeout(timer); paintClaimHighlights(root, []); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- points change with the prose, which renderKey tracks.
  }, [highlightKey, activeKey, renderKey, shown?.id]);
  const markerContext = useMemo(() => ({ points: ordered, activeKey, open, zh }), [ordered, activeKey, open, zh]);
  return { rootRef, claimMarkers: claimMarkers.length ? claimMarkers : undefined, ordered, open, markerContext };
}
