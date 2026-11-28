import type { FocusEvidence, FocusSection, FocusSession } from "../shared/focus-session";
import { factTextKey } from "../shared/project-fact-state";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { mapSemanticEvidence } from "../shared/semantic-structure";
import { wikiEvidenceHref, wikiEvidenceTarget, WIKI_EVIDENCE_LINK } from "../shared/wiki-evidence-link";
import { compactWikiSourceBlocks, wikiLedgerSourceBlock, type WikiKnowledgeLedger, type WikiUnitBatch } from "../shared/wiki-knowledge";
import { remapWikiClaimEvidence } from "../shared/wiki-source-reading";

export interface SectionChangeSummary {
  kind: "added" | "substantive" | "polish";
  addedClaims: number;
  removedClaims: number;
  lengthDelta: number;
}

const sameText = (left: FocusSection, right: FocusSection) => left.title === right.title && left.body === right.body && left.kind === right.kind;
const editorialWords = (text: string) => text.replace(/比如|举例来说/gu, "例如")
  .replace(/可以通过/gu, "可通过").replace(/\bfor instance\b/giu, "for example");
const proseKey = (text: string) => wikiDocumentBlocks(text).map(block => {
  if (block.kind === "code") return block.text.replace(/\r\n/gu, "\n");
  return block.text.split(/(\x60+[^\n]*?\x60+)/u).map((part, index) => index % 2 ? part : editorialWords(part.normalize("NFKC"))
    .replace(/^\s*(?:#{1,6}|[-*+]\s|\d+[.)]\s)\s*/gmu, "")
    .replace(/\*\*|__|\s/gu, "")).join("");
}).join("").replace(/([。！？!?])(?=$)/u, "");
const evidenceIdentity = (ref: FocusEvidence) => JSON.stringify([ref.conversationId, ref.messageId, ref.sourceVersionId, ref.sourceSignature, ref.excerpt]);
const proofIdentity = (ref: FocusEvidence) => JSON.stringify([ref.conversationId, ref.messageId, ref.sourceSignature ?? ref.sourceVersionId, ref.excerpt]);

function sectionFacts(session: FocusSession) {
  const evidence = new Map(session.evidence.map(ref => [ref.id, ref]));
  const bindings = (ids: string[]) => [...new Set(ids.flatMap(id => evidence.has(id) ? [proofIdentity(evidence.get(id)!)] : []))].sort();
  return (section: FocusSection) => ({
    bindings: JSON.stringify(bindings(section.evidenceIds)),
    claims: new Set((section.claims ?? []).filter(claim => !claim.markOnly).map(claim => JSON.stringify([
      factTextKey(editorialWords(claim.text)), claim.holder, Boolean(claim.userDecided), claim.workStatus, claim.scope,
      bindings(claim.evidenceIds), claim.quote.replace(/\s+/gu, " ").trim(),
    ]))),
  });
}

/** Compare saved versions; this does not estimate the executed AI scope. */
export function updatePreview(previous: FocusSession, next: FocusSession) {
  const previousBySection = new Map<string, FocusSession["sections"][number]>(), used = new Set<string>();
  for (const section of next.sections) {
    const candidates = previous.sections.filter(item => !used.has(item.id));
    const byTitle = candidates.filter(item => item.title === section.title && item.kind === section.kind);
    const byText = candidates.filter(item => item.body === section.body && item.kind === section.kind);
    // Generated section-N IDs are ordinals and can shift after a chapter is
    // inserted. Do not compare an unrelated chapter solely by that ID.
    const stable = candidates.find(item => item.id === section.id && (next.wikiContentReview?.basisSessionId === previous.id || !/^section-\d+$/u.test(item.id)));
    const owner = section.wikiOwnerId && candidates.filter(item => item.wikiOwnerId === section.wikiOwnerId);
    const old = stable ?? (owner && owner.length === 1 ? owner[0] : byTitle.length === 1 ? byTitle[0] : byText.length === 1 ? byText[0] : undefined);
    if (old) { used.add(old.id); previousBySection.set(section.id, old); }
  }
  const previousFacts = sectionFacts(previous), nextFacts = sectionFacts(next);
  const changeSummaryBySection = new Map<string, SectionChangeSummary>();
  const changed = next.sections.filter(section => {
    const old = previousBySection.get(section.id), after = nextFacts(section);
    const before = old ? previousFacts(old) : { claims: new Set<string>(), bindings: "" };
    const addedClaims = [...after.claims].filter(claim => !before.claims.has(claim)).length;
    const removedClaims = [...before.claims].filter(claim => !after.claims.has(claim)).length;
    const substantive = addedClaims > 0 || removedClaims > 0 || before.bindings !== after.bindings;
    if (old && sameText(old, section) && !substantive) return false;
    const kind = !old ? "added" : !substantive && old.kind === section.kind
      && proseKey(old.body) === proseKey(section.body) ? "polish" : "substantive";
    changeSummaryBySection.set(section.id, { kind, addedClaims, removedClaims, lengthDelta: section.body.length - (old?.body.length ?? 0) });
    return true;
  });
  const removed = previous.sections.filter(section => !used.has(section.id));
  const unchanged = next.sections.length - changed.length;
  const noteKeys = (session: FocusSession) => [
    ...Object.values(session.sectionNotes ?? {}).filter(note => note.text.trim() && !note.deletedAt).map(note => note.text.trim()),
    ...(session.detachedNotes ?? []).filter(note => !note.deletedAt && note.text.trim()).map(note => note.text.trim()),
    ...(session.notes.trim() ? [session.notes.trim()] : []),
  ];
  // Chapter notes may move into detached notes with a new title after a chapter
  // is replaced. Count the preserved text, including carry-forward wrappers.
  const nextNotes = noteKeys(next);
  const retainedNotes = noteKeys(previous).filter(text => nextNotes.some(nextText => nextText === text || nextText.includes(text))).length;
  const personalCards = (session: FocusSession) => [...session.sections, ...session.sections.flatMap(section => section.understandingPath ?? [])].filter(section => section.origin === "user" || section.userEdited);
  const nextCards = personalCards(next);
  const preservedCards = personalCards(previous).filter(section => nextCards.some(item => item.id === section.id && sameText(item, section))).length;
  return { changed, removed, unchanged, retainedNotes, preservedCards, previousBySection, changeSummaryBySection };
}

type SectionChoice = { section: FocusSection; owner: string; adopted: boolean };

function selectiveLedger(previous: FocusSession, proposal: FocusSession, choices: SectionChoice[], replaced: ReadonlySet<string>) {
  const prior = previous.wikiKnowledge, candidate = proposal.wikiKnowledge;
  if (!candidate || candidate === prior) return prior;
  const organization = prior?.organization ?? candidate.organization;
  const draft = prior?.draft ?? candidate.draft;
  const previousUnits = new Set<string>(), candidateUnits = new Set<string>();
  const chapterUnits = (book: WikiKnowledgeLedger | undefined, owner: string) => {
    const chapter = book?.organization?.chapters.find(page => page.id === owner);
    const subjects = new Set(chapter?.subtopics.flatMap(topic => topic.subjectIds));
    const written = book?.draft?.chapters.find(page => page.id === owner);
    return [...new Set([
      ...book?.organization?.subjects.filter(subject => subjects.has(subject.id)).flatMap(subject => subject.unitIds) ?? [],
      ...written?.openingUnitIds ?? [], ...written?.paragraphs.flatMap(paragraph => paragraph.unitIds) ?? [],
    ])];
  };
  for (const { section, owner, adopted } of choices) {
    const available = adopted ? candidateUnits : previousUnits;
    chapterUnits(adopted ? candidate : prior, owner).forEach(id => available.add(id));
    section.claims?.forEach(claim => claim.unitIds?.forEach(id => available.add(id)));
  }
  const retired = new Set(previous.sections.filter(section => replaced.has(section.id)).flatMap(section => [
    ...chapterUnits(prior, section.wikiOwnerId ?? section.id), ...section.claims?.flatMap(claim => claim.unitIds ?? []) ?? [],
  ]).filter(id => !previousUnits.has(id)));
  const freshIds = new Set(candidate.batches.flatMap(batch => batch.units.map(unit => unit.id)));
  const kept = new Set<string>();
  const collect = (book: WikiKnowledgeLedger | undefined, include: (id: string) => boolean) => book?.batches.flatMap(batch => {
    const units = batch.units.filter(unit => include(unit.id) && !kept.has(unit.id)).map(unit => {
      const code = wikiLedgerSourceBlock(book, unit);
      return code && !unit.evidence.code ? { ...unit, evidence: { ...unit.evidence, code } } : unit;
    });
    if (!units.length && batch.units.length) return [];
    units.forEach(unit => kept.add(unit.id));
    if (units.length === batch.units.length) return [{ ...batch, units }];
    // A subset cannot certify coverage for the original request.
    const partial: WikiUnitBatch = { sourceIds: [], status: "ok", units, rejected: {},
      ...(batch.fidelityResults ? { fidelityResults: Object.fromEntries(units.flatMap(unit =>
        batch.fidelityResults?.[unit.id] ? [[unit.id, batch.fidelityResults[unit.id]]] : [])) } : {}) };
    return [partial];
  }) ?? [];
  const oldBatches = collect(prior, id => (!retired.has(id) || candidateUnits.has(id) && !freshIds.has(id))
    && (!candidateUnits.has(id) || previousUnits.has(id) || !freshIds.has(id)));
  const newBatches = collect(candidate, id => candidateUnits.has(id)).filter(batch => batch.units.length);
  const occupied = new Set(oldBatches.flatMap(batch => batch.sourceIds));
  const batches = [...oldBatches, ...newBatches.map(batch => {
    if (batch.sourceIds.some(id => occupied.has(id))) return { ...batch, sourceIds: [], signature: undefined };
    batch.sourceIds.forEach(id => occupied.add(id));
    return batch;
  })];
  const freshOnly = (id: string) => candidateUnits.has(id) && !previousUnits.has(id) && freshIds.has(id);
  const decisions = Object.fromEntries([...kept].flatMap(id => {
    const verdict = (freshOnly(id) ? candidate : prior)?.decisions?.[id];
    return verdict ? [[id, verdict] as const] : [];
  }));
  const oldReceipts = Object.entries(prior?.decisionArbitrations ?? {}).filter(([, receipt]) =>
    receipt.unitIds?.every(id => kept.has(id) && !freshOnly(id)) ?? true);
  const candidateReceipts = Object.entries(candidate.decisionArbitrations ?? {}).filter(([, receipt]) =>
    receipt.unitIds?.length && receipt.unitIds.every(id => kept.has(id) && freshOnly(id)));
  const decisionArbitrations = Object.fromEntries([...oldReceipts, ...candidateReceipts]);
  // Build the visible directory from each chapter's actual owner. Keep source
  // batches and their provenance, while avoiding whole-project fit results
  // that only describe the unaccepted candidate.
  const subjects: NonNullable<WikiKnowledgeLedger["organization"]>["subjects"] = [];
  const chapters = choices.flatMap(({ section, owner, adopted }) => {
    const layout = (adopted ? candidate : prior)?.organization;
    const chapter = layout?.chapters.find(page => page.id === owner);
    if (!chapter) return [];
    const id = section.wikiOwnerId ?? section.id;
    const subtopics = chapter.subtopics.map(topic => ({ ...topic, subjectIds: topic.subjectIds.flatMap(subjectId => {
      const subject = layout?.subjects.find(item => item.id === subjectId);
      const ids = subject?.unitIds.filter(unitId => kept.has(unitId)) ?? [];
      if (!subject || !ids.length) return [];
      const scopedId = JSON.stringify([id, subjectId]);
      if (!subjects.some(item => item.id === scopedId)) subjects.push({ ...subject, id: scopedId, unitIds: ids });
      return [scopedId];
    }) }));
    return [{ ...chapter, id, title: section.title, subtopics }];
  });
  const written = choices.flatMap(({ section, owner, adopted }) => {
    const chapter = (adopted ? candidate : prior)?.draft?.chapters.find(page => page.id === owner);
    if (!chapter) return [];
    const inLedger = (ids: string[]) => ids.filter(id => kept.has(id));
    return [{ ...chapter, id: section.wikiOwnerId ?? section.id, title: section.title,
      openingUnitIds: chapter.openingUnitIds && inLedger(chapter.openingUnitIds),
      paragraphs: chapter.paragraphs.map(paragraph => ({ ...paragraph, unitIds: inLedger(paragraph.unitIds),
        claims: paragraph.claims?.map(claim => ({ ...claim, unitIds: inLedger(claim.unitIds) })).filter(claim => claim.unitIds.length) })) }];
  });
  return compactWikiSourceBlocks({
    ...(prior ?? candidate), batches, materials: new Set(batches.flatMap(batch => batch.sourceIds)).size, decisions,
    organization: organization && { version: organization.version, generatedAt: organization.generatedAt,
      status: organization.status, report: {}, subjects, chapters,
      merged: organization.merged.filter(row => kept.has(row.id)).map(row => ({ ...row, from: row.from.filter(id => kept.has(id)) })),
      relations: organization.relations.filter(row => kept.has(row.older) && kept.has(row.newer)),
    },
    draft: draft && { version: draft.version, generatedAt: draft.generatedAt, status: draft.status,
      writingMode: draft.writingMode, report: {}, chapters: written },
    sourceBlocks: undefined,
    decisionArbitrations,
    decisionsAt: Math.max(prior?.decisionsAt ?? 0, ...Object.values(decisions).map(decision => decision.at),
      ...candidateReceipts.map(([, receipt]) => receipt.at)) || undefined,
    userAnswers: prior?.userAnswers?.filter(answer => answer.unitIds.every(id => kept.has(id))),
    writingQuestions: prior?.writingQuestions?.filter(question => question.unitIds.every(id => kept.has(id))
      && question.options.every(option => option.actions.every(action => action.units.every(id => kept.has(id))))),
  });
}

/** Build a publishable candidate from the selected pages, keeping each page's
 * own source version. Unaccepted source changes remain pending. */
export function applySelectiveUpdatePreview(previous: FocusSession, proposal: FocusSession, acceptedSectionIds: ReadonlySet<string>): FocusSession {
  const { changed, removed, previousBySection } = updatePreview(previous, proposal);
  const selected = changed.filter(section => acceptedSectionIds.has(section.id));
  const removedIds = new Set(removed.filter(section => acceptedSectionIds.has(section.id)).map(section => section.id));
  if (selected.length === changed.length && removedIds.size === removed.length) return proposal;
  if (!selected.length && !removedIds.size) return previous;

  const byPrevious = new Map(selected.flatMap(section => {
    const old = previousBySection.get(section.id);
    return old ? [[old.id, section] as const] : [];
  }));
  const choices: SectionChoice[] = [];
  const sectionIds = new Set(previous.sections.filter(section => !removedIds.has(section.id)).map(section => section.id));
  for (const section of previous.sections) {
    if (removedIds.has(section.id)) continue;
    const replacement = byPrevious.get(section.id);
    if (replacement) choices.push({ section: { ...replacement, id: section.id }, owner: replacement.wikiOwnerId ?? replacement.id, adopted: true });
    else choices.push({ section, owner: section.wikiOwnerId ?? section.id, adopted: false });
  }
  for (const added of selected.filter(section => !previousBySection.has(section.id))) {
    let id = added.id;
    while (sectionIds.has(id)) id = `selected:${id}`;
    sectionIds.add(id);
    choices.push({ section: { ...added, id }, owner: added.wikiOwnerId ?? added.id, adopted: true });
  }

  const usedOwners = new Set(choices.filter(choice => !choice.adopted).map(choice => choice.owner));
  const oldEvidence = previous.evidence.map(ref => ref.sourceVersionId || !previous.sourceVersionIds?.[ref.conversationId]
    ? ref : { ...ref, sourceVersionId: previous.sourceVersionIds[ref.conversationId] });
  const evidence = new Map(oldEvidence.map(ref => [ref.id, ref]));
  const byBinding = new Map(oldEvidence.map(ref => [evidenceIdentity(ref), ref.id]));
  const candidateRefs = new Map(proposal.evidence.map(ref => [ref.id, ref]));
  const refs = new Map<string, string>();
  const changedSources = new Map<string, Set<string>>();
  const resolveRef = (id: string) => {
    const match = refs.get(id);
    if (match) return match;
    const original = candidateRefs.get(id);
    if (!original) {
      if (evidence.has(id)) return id;
      return undefined;
    }
    const ref = { ...original, sourceVersionId: original.sourceVersionId ?? proposal.sourceVersionIds?.[original.conversationId] };
    const binding = evidenceIdentity(ref);
    const prior = byBinding.get(binding);
    let key = prior ?? id;
    if (!prior) {
      while (evidence.has(key)) key = `selected:${key}`;
      evidence.set(key, { ...ref, id: key });
      byBinding.set(binding, key);
    }
    refs.set(id, key);
    const messages = changedSources.get(ref.conversationId) ?? new Set<string>();
    messages.add(ref.messageId);
    changedSources.set(ref.conversationId, messages);
    return key;
  };
  const resolveRefs = (ids: string[]) => [...new Set(ids.flatMap(id => resolveRef(id) ?? []))];
  const adoptSection = (section: FocusSection): FocusSection => {
    const required = [...section.evidenceIds, ...section.claims?.flatMap(claim => claim.evidenceIds) ?? []];
    if (required.some(id => !resolveRef(id))) throw new Error(previous.locale === "en"
      ? "A selected chapter is missing its original reference. The saved version is retained."
      : "所选章节缺少引用，请重新打开预览。原版本已保留。");
    const evidenceIds = resolveRefs(section.evidenceIds);
    for (const claim of section.claims ?? []) resolveRefs([...claim.evidenceIds, ...claim.sourceReading?.sources.map(source => source.id) ?? []]);
    const body = section.body.replace(new RegExp(WIKI_EVIDENCE_LINK + "[^\\s)]+", "gu"), link => {
      const target = wikiEvidenceTarget(link), id = target && resolveRef(target.id);
      return id && evidence.has(id) ? wikiEvidenceHref(evidence.get(id)!, target?.table) : link;
    });
    return { ...section, body, evidenceIds,
      claims: section.claims?.map(claim => {
        const ids = new Map(refs);
        for (const id of claim.evidenceIds) if (!ids.has(id) && evidence.has(id)) ids.set(id, id);
        return remapWikiClaimEvidence(claim, ids);
      }),
      semanticStructure: mapSemanticEvidence(section.semanticStructure, resolveRefs),
      understandingPath: section.understandingPath?.map(adoptSection),
      wikiRevisionReceipt: section.wikiRevisionReceipt && { ...section.wikiRevisionReceipt,
        references: section.wikiRevisionReceipt.references.map(item => ({ ...item, evidenceIds: resolveRefs(item.evidenceIds) })) },
    };
  };
  for (const choice of choices) {
    if (!choice.adopted) continue;
    let owner = choice.owner;
    while (usedOwners.has(owner)) owner = `selected:${owner}`;
    usedOwners.add(owner);
    choice.section = adoptSection({ ...choice.section, wikiOwnerId: choice.section.wikiOwnerId || owner !== choice.section.id ? owner : undefined });
  }
  const sections = choices.map(choice => choice.section);
  const sourceConversationIds = [...new Set([...previous.sourceConversationIds, ...changedSources.keys()])];
  const sourceSignatures = { ...previous.sourceSignatures }, sourceRoles = { ...previous.sourceRoles },
    sourceMessageOrder = { ...previous.sourceMessageOrder }, sourceVersionIds = { ...previous.sourceVersionIds };
  for (const [conversationId, messageIds] of changedSources) {
    const accepted = (table: FocusSession["sourceSignatures"]) => Object.fromEntries([...messageIds].flatMap(id =>
      table?.[conversationId]?.[id] === undefined ? [] : [[id, table[conversationId][id]]]));
    const signatures = accepted(proposal.sourceSignatures);
    for (const ref of candidateRefs.values()) {
      if (ref.conversationId === conversationId && messageIds.has(ref.messageId) && ref.sourceSignature && !signatures[ref.messageId]) {
        signatures[ref.messageId] = ref.sourceSignature;
      }
    }
    if (Object.entries(signatures).some(([id, value]) => sourceSignatures[conversationId]?.[id] !== value)) delete sourceVersionIds[conversationId];
    sourceSignatures[conversationId] = { ...sourceSignatures[conversationId], ...signatures };
    sourceRoles[conversationId] = { ...sourceRoles[conversationId], ...accepted(proposal.sourceRoles) };
    const order = [...sourceMessageOrder[conversationId] ?? []], known = new Set(order);
    const proposedOrder = proposal.sourceMessageOrder?.[conversationId] ?? [...messageIds];
    for (const [index, id] of proposedOrder.entries()) {
      if (!messageIds.has(id) || known.has(id)) continue;
      const nextKnown = proposedOrder.slice(index + 1).find(candidate => known.has(candidate));
      order.splice(nextKnown ? order.indexOf(nextKnown) : order.length, 0, id);
      known.add(id);
    }
    sourceMessageOrder[conversationId] = [...order, ...[...messageIds].filter(id => !known.has(id))];
  }
  const scopeChanged = sourceConversationIds.some(id => !previous.sourceConversationIds.includes(id)) || previous.scope?.kind === "goal";
  const scope = scopeChanged ? { ...previous.scope, kind: "goal" as const, sourceConversationIds,
    blocks: sourceConversationIds.map(conversationId => {
      const oldBlocks = previous.scope?.kind === "goal" ? previous.scope.blocks?.filter(block => block.conversationId === conversationId) : undefined;
      const accepted = changedSources.get(conversationId) ?? new Set<string>();
      const prior = oldBlocks?.flatMap(block => block.messageIds)
        ?? (previous.sourceConversationIds.includes(conversationId)
          ? [...new Set([...previous.sourceMessageOrder?.[conversationId] ?? [], ...Object.keys(previous.sourceSignatures?.[conversationId] ?? {}),
            ...oldEvidence.filter(ref => ref.conversationId === conversationId).map(ref => ref.messageId)])] : []);
      const messageIds = [...new Set([...prior, ...accepted])];
      const title = oldBlocks?.[0]?.title ?? proposal.scope?.blocks?.find(block => block.conversationId === conversationId)?.title
        ?? [...evidence.values()].find(ref => ref.conversationId === conversationId)?.title ?? "";
      return { conversationId, title, messageIds,
        messageSignatures: Object.fromEntries(messageIds.flatMap(id => sourceSignatures[conversationId]?.[id] ? [[id, sourceSignatures[conversationId][id]]] : [])) };
    }),
  } : previous.scope;
  const sectionNotes = Object.fromEntries(Object.entries(previous.sectionNotes ?? {}).filter(([id]) => !removedIds.has(id)));
  const detachedNotes = [...previous.detachedNotes ?? [], ...previous.sections.flatMap(section => {
    const note = removedIds.has(section.id) && previous.sectionNotes?.[section.id];
    return note ? [{ ...note, title: section.title, section }] : [];
  })];
  return { ...previous, id: proposal.id, previousSessionId: previous.id, rootSessionId: previous.rootSessionId ?? previous.id,
    runId: proposal.runId, wikiPublishBasis: proposal.wikiPublishBasis, createdAt: proposal.createdAt, updatedAt: proposal.updatedAt,
    sections, evidence: [...evidence.values()], sectionNotes, detachedNotes,
    activeSectionId: sectionIds.has(previous.activeSectionId) ? previous.activeSectionId : sections[0]?.id ?? "",
    wikiOrder: [...new Set([...(previous.wikiOrder ?? []).filter(id => sectionIds.has(id)), ...sections.map(section => section.id)])],
    completedSectionIds: previous.completedSectionIds.filter(id => sectionIds.has(id) && !byPrevious.has(id)),
    visitedSectionIds: previous.visitedSectionIds?.filter(id => sectionIds.has(id)),
    reviewNeeds: Object.fromEntries(Object.entries(previous.reviewNeeds ?? {}).filter(([id]) => sectionIds.has(id) && !byPrevious.has(id))),
    wikiSuggestions: Object.fromEntries(Object.entries(previous.wikiSuggestions ?? {}).filter(([id]) => sectionIds.has(id) && !byPrevious.has(id))),
    sourceConversationIds, sourceSignatures, sourceRoles, sourceMessageOrder, sourceVersionIds, scope,
    wikiKnowledge: selectiveLedger(previous, proposal, choices, new Set([...byPrevious.keys(), ...removedIds])),
    wikiOverview: undefined, semanticOverview: undefined, projectState: undefined, projectKnowledge: undefined, wikiQuality: undefined,
    wikiVerification: undefined, wikiRevisionReceipt: undefined, wikiContentReview: undefined,
  };
}
