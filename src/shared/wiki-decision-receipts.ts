import { sourceMessageSignature } from "./source-signature";
import { aboutNameKey, wikiBlockedUnitIds, wikiLedgerUnits, type WikiDecisionOverride, type WikiKnowledgeLedger } from "./wiki-knowledge";

export type WikiDecisionReceipt = NonNullable<WikiKnowledgeLedger["decisionArbitrations"]>[string];

export function wikiDecisionScope(ledger: WikiKnowledgeLedger, ids: readonly string[], subject: string): WikiDecisionOverride {
  const units = new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit]));
  return { subject, targets: [...new Set(ids)].flatMap(id => {
    const unit = units.get(id);
    return unit ? [{ unitId: id, conversationId: unit.evidence.conversationId, messageId: unit.evidence.messageId,
      claim: unit.statement, quote: sourceMessageSignature(unit.evidence.quote) }] : [];
  }) };
}

export function staleWikiDecisionReceipts(ledger: WikiKnowledgeLedger) {
  const scoped = Object.entries(ledger.decisionArbitrations ?? {}).filter(([, receipt]) => receipt.scope?.targets.length);
  if (!scoped.length) return new Set<string>();
  const units = new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit]));
  const blocked = wikiBlockedUnitIds(ledger);
  return new Set(scoped.flatMap(([id, receipt]) => receipt.scope!.targets.some(target => {
    const unit = units.get(target.unitId);
    return !unit || blocked.has(unit.id) || unit.about && ledger.scopeAnswers?.[aboutNameKey(unit.about.name)] === "exclude"
      || unit.evidence.conversationId !== target.conversationId || unit.evidence.messageId !== target.messageId
      || unit.statement !== target.claim || sourceMessageSignature(unit.evidence.quote) !== target.quote;
  }) ? [id] : []));
}

function removeReceipts(ledger: WikiKnowledgeLedger, ids: ReadonlySet<string>) {
  if (!ids.size) return ledger;
  const decisionArbitrations = { ...ledger.decisionArbitrations }, decisions = { ...ledger.decisions };
  let coexisting = ledger.coexisting;
  for (const id of [...ids].sort((a, b) => (decisionArbitrations[b]?.at ?? 0) - (decisionArbitrations[a]?.at ?? 0))) {
    const receipt = decisionArbitrations[id];
    if (!receipt) continue;
    const prior = receipt.previousVerdicts ?? (!receipt.deferredToDraft && receipt.mode === "choose"
      ? Object.fromEntries((receipt.unitIds ?? []).filter(unitId => decisions[unitId]?.at === receipt.at).map(unitId => [unitId, null])) : {});
    for (const [unitId, previous] of Object.entries(prior)) {
      if (decisions[unitId] && decisions[unitId].at !== receipt.at) continue;
      if (previous) decisions[unitId] = previous;
      else delete decisions[unitId];
    }
    if (receipt.addedPairs?.length) coexisting = coexisting?.filter(pair => !receipt.addedPairs?.includes(pair));
    delete decisionArbitrations[id];
  }
  return { ...ledger, decisionArbitrations, decisions, coexisting,
    userAnswers: ledger.userAnswers?.filter(answer => !ids.has(answer.questionId)
      || ledger.decisionArbitrations?.[answer.questionId]?.at !== answer.at) };
}

export function withoutStaleWikiDecisionReceipts(ledger: WikiKnowledgeLedger) {
  return removeReceipts(ledger, staleWikiDecisionReceipts(ledger));
}

export function reopenWikiDecision(ledger: WikiKnowledgeLedger, id: string) {
  const receipt = ledger.decisionArbitrations?.[id];
  if (!receipt) return ledger;
  const reopened = removeReceipts(ledger, new Set([id]));
  const alreadyWritten = !receipt.deferredToDraft || receipt.at <= (ledger.draft?.generatedAt ?? 0);
  const at = Math.max(Date.now(), ledger.decisionsAt ?? 0, ledger.draft?.generatedAt ?? 0) + 1;
  const draftAt = ledger.draft?.generatedAt;
  const earlier = ledger.publishedDecisionRevisions?.[id];
  const publishedDecisionRevisions = alreadyWritten && draftAt !== undefined && earlier?.draftAt !== draftAt
    ? { ...ledger.publishedDecisionRevisions, [id]: { draftAt, at, receipt,
      verdicts: Object.fromEntries(Object.keys(receipt.previousVerdicts ?? {}).map(unitId => [unitId, ledger.decisions?.[unitId] ?? null])),
      answer: ledger.userAnswers?.find(answer => answer.questionId === id) } } : ledger.publishedDecisionRevisions;
  return { ...reopened, publishedDecisionRevisions, decisionsAt: alreadyWritten || earlier?.draftAt === draftAt && earlier
    ? at : Math.max(ledger.draft?.generatedAt ?? 0,
    ...Object.values(reopened.decisions ?? {}).map(decision => decision.at), ...Object.values(reopened.decisionArbitrations ?? {}).map(decision => decision.at),
    ...reopened.userAnswers?.map(answer => answer.at) ?? []) };
}

export function wikiLedgerAtPublishedDraft(ledger: WikiKnowledgeLedger) {
  const since = ledger.draft?.generatedAt ?? 0;
  const pending = Object.entries(ledger.decisionArbitrations ?? {}).filter(([, receipt]) => receipt.deferredToDraft && receipt.at > since);
  const published = Object.entries(ledger.publishedDecisionRevisions ?? {}).filter(([, previous]) => previous.draftAt === since);
  const view = removeReceipts(ledger, new Set(pending.map(([id]) => id)));
  if (!published.length) return view;
  const decisionArbitrations = { ...view.decisionArbitrations }, decisions = { ...view.decisions };
  const userAnswers = [...view.userAnswers ?? []];
  for (const [id, previous] of published) {
    decisionArbitrations[id] = previous.receipt;
    for (const [unitId, verdict] of Object.entries(previous.verdicts)) {
      if ((decisions[unitId]?.at ?? 0) > previous.at) continue;
      if (verdict) decisions[unitId] = verdict;
      else delete decisions[unitId];
    }
    if (previous.answer && !userAnswers.some(answer => answer.questionId === id)) userAnswers.push(previous.answer);
  }
  return { ...view, decisionArbitrations, decisions, userAnswers };
}
