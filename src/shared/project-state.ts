import { overstatesProjectEvidence } from "./project-assertion";
import { statementEvidence, confirmsProposal } from "./statement-evidence";
import type { FocusSession } from "./focus-session";
import { sourceMessageSignature } from "./source-signature";
import { evidencePresentation } from "./evidence-presentation";
import { compareHistoryPositions, historyProofPosition, type HistoryPosition } from "./history-order";
import {validateMatterAssessment,currentMatterSettlement,type MatterAssessment} from "./project-matter-assessment";

export interface ProjectSource {
  id: string;
  conversationId: string;
  messageId: string;
  signature: string;
  role: string;
  messageIndex?: number;
  discussedAt?: number;
}

export type ProjectRecordStatus = "documented" | "proposal" | "uncertain" | "superseded";
export interface ProjectRecord {
  matter?:MatterAssessment;
  /** Retained records keep their old source basis until explicitly reviewed. */
  sourceBasisSignature?: string;
  displayTitle?: string;
  id: string;
  text: string;
  reason: string;
  status: ProjectRecordStatus;
  quote: string;
  evidenceIds: string[];
}
export interface ProjectModule {
  id: string;
  title: string;
  layer: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  status: ProjectRecordStatus;
  quote: string;
  evidenceIds: string[];
}
/** Product evolution discussed in original messages, independent of ChatAtlas save revisions. */
export type ProjectHistoryRelationKind = "replaces" | "narrows" | "supplements" | "coexists" | "rejects";
/** A model's pointer from a change to the earlier state it names. Unproven:
 * the application resolves it against originals before it can retire anything. */
export interface ProjectHistoryRelationHint { kind: ProjectHistoryRelationKind; targetId?: string; hint?: string }
/** Application-resolved link between two claims, keyed by stable claim IDs
 * rather than wording. "unresolved" keeps the reason and is never a replacement. */
export interface ProjectHistoryRelation {
  id: string; fromClaimId: string; toClaimId?: string; kind: ProjectHistoryRelationKind;
  evidenceIds: string[]; confirmationEvidenceIds: string[]; reasonEvidenceIds: string[];
  resolution: "supported" | "unresolved";
  reason?: "ambiguous" | "no_candidate" | "not_user_decision" | "no_change_language" | "order_unknown";
  hint?: string;
}
export interface ProjectHistoryEvent {
  /** Stable across batches, caches and rewording: original message and quote, not prose. */
  claimId?: string;
  pendingRelation?: ProjectHistoryRelationHint;
  /** Resolved from originals by the application; never accepted from model output. */
  relations?: ProjectHistoryRelation[];
  /** Application-maintained identity/relations; model values never establish these. */
  subjectId?: string;
  supersedesIds?: string[];
  relatedEventIds?: string[];
  /** Optional for old records. Navigation classification never approves a plan. */
  recordKind?: "event" | "proposal" | "reference";
  id: string;
  title: string;
  version: string;
  before: string;
  after: string;
  reason: string;
  status: "documented" | "proposal" | "uncertain";
  /** Optional on old histories; a subject, not an ChatAtlas save revision. */
  area?: string;
  /** Application-maintained aliases from reviewed duplicate accounts, never model-extracted facts. */
  areaAliases?: string[];
  changeKind?: "adopt" | "add" | "change" | "retire";
  /** Explicit original user choice, independently reviewed; discussed is not approved. */
  decisionStatus?: "confirmed" | "proposed" | "unknown";
  workStatus?: "planned" | "in_progress" | "reported_complete" | "released" | "unknown";
  workQuote?: string;
  workEvidenceIds?: string[];
  /** A later original USER message can approve the preceding version proposal. */
  confirmationQuote?: string;
  confirmationEvidenceIds?: string[];
  position?: HistoryPosition;
  confirmationPosition?: HistoryPosition;
  quote: string;
  evidenceIds: string[];
  beforeQuote: string;
  beforeEvidenceIds: string[];
  discussedAt?: number;
  additions?: ProjectHistoryDetail[];
  modifications?: ProjectHistoryDetail[];
  reasonQuote?: string;
  reasonEvidenceIds?: string[];
  /** Additional literal accounts of the same event, with their own quotations. */
  corroborations?: Array<{ quote: string; evidenceIds: string[] }>;
}
export interface ProjectHistoryDetail { text: string; quote: string; evidenceIds: string[] }
export function projectHistoryProofs(item: ProjectHistoryEvent) {
  return [item, { quote: item.beforeQuote, evidenceIds: item.beforeEvidenceIds }, ...(item.additions ?? []), ...(item.modifications ?? []), ...(item.corroborations??[]), { quote: item.reasonQuote ?? "", evidenceIds: item.reasonEvidenceIds ?? [] }, { quote: item.confirmationQuote ?? "", evidenceIds: item.confirmationEvidenceIds ?? [] }, {quote:item.workQuote??"",evidenceIds:item.workEvidenceIds??[]}];
}
export interface ProjectState {
  matterAssessmentVersion?:1;
  matterAnalysisVersion?: 1;
  analysisScopeSignature?: string;
  analyzedParts?: Array<"architecture" | "decisions">;
  /** Each independently generated part keeps its own material revision. */
  partSignatures?: Partial<Record<"architecture" | "decisions", string>>;
  summary: string;
  modules: ProjectModule[];
  relations: Array<{ from: string; to: string; label: string; kind: "flow" | "contains" | "requires" | "feedback"; quote: string; evidenceIds: string[] }>;
  /** Uncertain links are retained for source review, never drawn as established connections. */
  pendingRelations?: Array<ProjectState["relations"][number] & { reason: string }>;
  reviewNotes?: Array<{ key: string; category: string; reason: string }>;
  decisions: ProjectRecord[];
  constraints: ProjectRecord[];
  actions: ProjectRecord[];
  /** Absent on legacy results. Superseded questions have an explicitly sourced answer. */
  questions?: ProjectRecord[];
  sources?: ProjectSource[];
  history?: ProjectHistoryEvent[];
  verification?: "original";
  signature: string;
  generatedAt: number;
  /** This is a consolidation of organized material, not a code or deployment audit. */
  basis: "organized";
}
export function projectRecordProofs(record:ProjectRecord){return [record,...(record.matter?.settlement?[record.matter.settlement]:[])];}
export interface ProjectMatterDetails {
  /** User organization only; never a fact, source link or confirmation. */
  category?: string;
  confirmationSignature?: string;
  updatedAt?: number;
  resolutionUpdatedAt?: number;
  relatedMatters?: Array<{id:string; type:"question"|"decision"|"boundary"}>;
  mergedInto?: {id:string; type:"question"|"decision"|"boundary"};
  basisText?: string;
  displayTitle?: string;
  matterStatus?: "open" | "resolved" | "dismissed";
  resolution?: string;
  resolutionReason?: string;
  options?: string;
  rejected?: string;
  included?: string;
  excluded?: string;
  phase?: string;
  linkedKnowledgeIds?: string[];
  resolutionHistory?: Array<{ resolution: string; reason: string; status: "open" | "resolved" | "dismissed"; recordedAt: number }>;
}
export interface ProjectMaintenance {
  /** User-approved navigation scopes; never evidence or decision confirmation. */
  evolutionScopes?: { signature:string; groups:Array<{id:string;title:string;eventIds:string[]}> };
  nextMatter?: {id:string;type:"question"|"decision"|"boundary"};
  evolutionEvents?: Record<string, { hidden?:boolean; updatedAt:number; edited?:ProjectEvolutionEdit; personal?:boolean }>;
  overview?: string;
  modules?: Record<string, ProjectModule & { basisSignature?: string; wikiSectionIds?: string[] }>;
  actions?: Record<string, { text: string; done: boolean }>;
  decisions?: Record<string, ProjectMatterDetails & { text: string; basisText?: string; confirmed: boolean; hidden?: boolean }>;
  constraints?: Record<string, ProjectMatterDetails & { text: string; hidden?: boolean; confirmed?: boolean }>;
  /** User changes to a product release; original analyzed events and evidence are retained. */
  productReleases?: Record<string, { hidden?: boolean; updatedAt: number; edited?: ProjectReleaseEdit; editedFields?: Array<keyof ProjectReleaseEdit> }>;
  acceptedSignature?: string;
  questions?: Record<string, ProjectMatterDetails & { text: string; originalText?: string; hidden?: boolean; resolved: boolean; resolvedAt?: number; sources?: FocusSession["evidence"] }>;
}
export interface ProjectEvolutionEdit {
  title:string; version:string; before:string; after:string; reason:string;
  decisionStatus: "confirmed" | "proposed" | "unknown";
  workStatus: "planned" | "in_progress" | "reported_complete" | "released" | "unknown";
  discussedAt?:number; sectionIds?:string[];
}
export interface ProjectReleaseEdit {
  version: string;
  summary: string;
  additions: string[];
  modifications: string[];
  reason: string;
}

const statuses: ProjectRecordStatus[] = ["documented", "proposal", "uncertain", "superseded"];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const clean = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit && Boolean(value.trim());
const normalized = (value: string) => value.trim().replace(/\s+/gu, " ");
const key = (value: string) => normalized(value).normalize("NFKC").toLowerCase();
export function projectOpenQuestions(session: FocusSession): string[] {
  return projectQuestionItems(session).filter(item => !item.resolved && !item.dismissed).map(item => item.text);
}
export const projectQuestionKey = (text: string) => `question:${sourceMessageSignature(key(evidencePresentation(text)))}`;
export function projectQuestionItems(session: FocusSession) {
  const items = new Map<string, { key: string; text: string; resolved: boolean; dismissed?: boolean; personal: boolean; resolvedAt?: number; sources: FocusSession["evidence"] }>();
  const add = (text: string, resolved: boolean, sources: FocusSession["evidence"]) => {
    const cleanText = normalized(text), id = projectQuestionKey(cleanText);
    if (cleanText && !items.has(id)) items.set(id, { key: id, text: cleanText, resolved, personal: false, sources });
  };
  for (const item of session.projectState?.questions ?? []) {
    const settlement=currentMatterSettlement(session,item);
    add(item.text,item.status==="superseded"&&!item.matter||Boolean(settlement&&item.matter?.state==="settled"),session.evidence.filter(ref=>item.evidenceIds.includes(ref.id)||settlement?.evidenceIds.includes(ref.id)));
    const row=items.get(projectQuestionKey(normalized(item.text)));
    if(row&&settlement&&item.matter?.state==="withdrawn")row.dismissed=true;
  }
  for (const text of session.brief?.openQuestions ?? []) add(session.briefUserEdited ? text : evidencePresentation(text), false, []);
  for (const [id, record] of Object.entries(session.projectMaintenance?.questions ?? {})) {
    if (id !== projectQuestionKey(record.originalText ?? record.text)) continue;
    if (record.hidden) { items.delete(id); continue; }
    const item = items.get(id);
    items.set(id, { key: id, text: record.text, resolved: record.matterStatus ? record.matterStatus === "resolved" : record.resolved, dismissed:record.matterStatus === "dismissed", personal: true, resolvedAt: record.resolvedAt, sources: item?.sources.length ? item.sources : record.sources ?? [] });
  }
  return [...items.values()];
}
export const moduleSignature = (item: ProjectModule) => sourceMessageSignature(JSON.stringify([item.title, item.layer, item.purpose, item.inputs, item.outputs, item.status]));
export const projectRelationKey = (edge: ProjectState["relations"][number]) => `edge:${sourceMessageSignature(JSON.stringify([edge.from, edge.to, edge.kind]))}`;
export const projectVersionSignature = (state: ProjectState) => sourceMessageSignature(JSON.stringify([state.signature, state.summary, state.modules, state.relations, state.decisions, state.constraints, state.actions, ...(state.questions ? [state.questions] : []), ...(state.history ? [state.history] : [])]));
export const projectAnalysisScopeSignature = (session: FocusSession) => sourceMessageSignature(JSON.stringify([session.goal, session.scope, session.sourceConversationIds]));
export const projectStateSignature = (session: FocusSession) => {
  if (session.sourceSignatures && session.sourceRoles && session.sourceMessageOrder) return sourceMessageSignature(JSON.stringify([2, session.goal, session.scope, session.sourceConversationIds, session.sourceSignatures, session.sourceRoles, session.sourceMessageOrder]));
  return legacyProjectStateSignature(session);
};
export const legacyProjectStateSignature = (session: FocusSession) => {
  const sections = session.sections.filter(section => !section.origin);
  const used = new Set(sections.flatMap(section => section.evidenceIds));
  return sourceMessageSignature(JSON.stringify([session.goal, session.scope, session.sourceConversationIds, session.sourceSignatures, sections.map(section => [section.id, section.wikiOriginalTitle ?? section.title, section.body, section.evidenceIds]), session.evidence.filter(ref => used.has(ref.id))]));
};

/** Evidence membership and literal quotations are validated. This cannot prove semantic truth. */
export function validateProjectState(value: unknown, sources: Array<{ id: string; text: string; discussedAt?: number; role?: string; conversationId?: string; messageId?: string; messageIndex?: number; partial?: boolean }>, session: FocusSession): ProjectState {
  if (!object(value) || !clean(value.summary, 900) || !Array.isArray(value.modules) || !Array.isArray(value.relations) || value.modules.length > 256 || value.relations.length > 512) throw new Error("Invalid project state");
  const byId = new Map<string, string[]>();
  for (const source of sources) byId.set(source.id, [...(byId.get(source.id) ?? []), normalized(source.text)]);
  const supports = (id: string, quote: string) => byId.get(id)?.some(text => text.includes(normalized(quote))) === true;
  const allowed = new Set(session.evidence.filter(ref => session.sourceConversationIds.includes(ref.conversationId) && (session.scope?.kind !== "goal" || session.scope.blocks?.some(block => block.conversationId === ref.conversationId && block.messageIds.includes(ref.messageId)))).map(ref => ref.id));
  const provenance = (item: Record<string, unknown>) => {
    if (!clean(item.quote, 350) || !Array.isArray(item.evidenceIds) || !item.evidenceIds.length || item.evidenceIds.length > 24 || item.evidenceIds.some(id => typeof id !== "string" || !allowed.has(id) || !byId.has(id)) || !(item.evidenceIds as string[]).some(id => supports(id, item.quote as string))) throw new Error("Project claim has no supplied evidence");
    // Keep only references containing the actual quotation. A real ID alone
    // must not attach an unrelated message to a conclusion.
    return { quote: item.quote.trim(), evidenceIds: [...new Set(item.evidenceIds as string[])].filter(id => supports(id, item.quote as string)) };
  };
  const used = new Set<string>();
  const identity = (item: Record<string, unknown>) => {
    if (!clean(item.id, 100) || used.has(key(item.id))) throw new Error("Invalid project record identity");
    const id = key(item.id); used.add(id); return id;
  };
  const status = (item: Record<string, unknown>) => {
    if (!statuses.includes(item.status as ProjectRecordStatus)) throw new Error("Invalid project status");
    return item.status as ProjectRecordStatus;
  };
  const list = (input: unknown) => {
    if (!Array.isArray(input) || input.length > 8 || input.some(item => !clean(item, 160))) throw new Error("Invalid module interface");
    return [...new Set((input as string[]).map(normalized))];
  };
  const modules = value.modules.map(item => {
    if (!object(item) || !clean(item.title, 60) || !clean(item.layer, 50) || !clean(item.purpose, 500)) throw new Error("Invalid project module");
    return { id: identity(item), title: item.title.trim(), layer: item.layer.trim(), purpose: item.purpose.trim(), inputs: list(item.inputs), outputs: list(item.outputs), status: status(item), ...provenance(item) };
  });
  const moduleIds = new Set(modules.map(item => item.id));
  const relations: ProjectState["relations"] = [];
  for (const item of value.relations) {
    if (!object(item) || typeof item.from !== "string" || typeof item.to !== "string" || key(item.from) === key(item.to) || !moduleIds.has(key(item.from)) || !moduleIds.has(key(item.to)) || !clean(item.label, 60) || !["flow", "contains", "requires", "feedback"].includes(String(item.kind))) throw new Error("Invalid project relationship");
    const relation = { from: key(item.from), to: key(item.to), label: item.label.trim(), kind: item.kind as ProjectState["relations"][number]["kind"], ...provenance(item) };
    if (!relations.some(edge => edge.from === relation.from && edge.to === relation.to && edge.kind === relation.kind)) relations.push(relation);
  }
  const records = (items: unknown, field: string) => {
    if (!Array.isArray(items)) throw new Error(`Invalid project records: ${field} must be an array`);
    if (items.length > 128) throw new Error(`Invalid project records: ${field} exceeds 128 items`);
    return items.map(item => {
      if (!object(item) || !clean(item.text, 500) || typeof item.reason !== "string" || item.reason.length > 500) throw new Error("Invalid project record");
      const proof=provenance(item);
      if(overstatesProjectEvidence(item.text,"recorded")){
        const users=proof.evidenceIds.flatMap(id=>sources.filter(source=>source.id===id&&source.role==="user"&&supports(id,proof.quote)));
        const reported=users.some(source=>statementEvidence(source.text,proof.quote).report);
        const approved=users.some(source=>statementEvidence(source.text,proof.quote).decision);
        if(!reported&&!approved||overstatesProjectEvidence(item.text,reported?"reported":"confirmed"))throw new Error("Invalid project status attribution: original evidence does not support approval or implementation");
      }
      const matter=validateMatterAssessment(item.matter,proof,sources,session);
      return { ...(typeof item.displayTitle==="string"&&item.displayTitle.trim()&&item.displayTitle.length<=60?{displayTitle:item.displayTitle.trim()}:{}), id: identity(item), text: item.text.trim(), reason: item.reason.trim(), status: status(item), ...proof,...(matter?{matter}:{}) };
    });
  };
  const history = value.history === undefined ? undefined : (() => {
    if (!Array.isArray(value.history) || value.history.length > 32) throw new Error("Invalid project history");
    return value.history.map(item => {
      if (!object(item) || !clean(item.title, 100) || !clean(item.after, 500) || typeof item.version !== "string" || item.version.length > 60 || typeof item.before !== "string" || item.before.length > 500 || typeof item.reason !== "string" || item.reason.length > 300 || !["documented", "proposal", "uncertain"].includes(String(item.status))) throw new Error("Invalid project history event");
      if(item.recordKind!==undefined&&!["event","proposal","reference"].includes(String(item.recordKind)))throw new Error("Invalid evolution record kind");
      if(item.recordKind&&item.recordKind!=="event"&&item.decisionStatus==="confirmed")throw new Error("Discussion or reference cannot be a confirmed evolution event");
      const proof = provenance(item);
      if (item.area !== undefined && !clean(item.area, 60) || item.changeKind !== undefined && !["adopt", "add", "change", "retire"].includes(String(item.changeKind)) || item.decisionStatus !== undefined && !["confirmed", "proposed", "unknown"].includes(String(item.decisionStatus))) throw new Error("Invalid evolution metadata");
      const position = historyProofPosition(session, sources, proof);
      const confirmation = item.confirmationQuote ? provenance({ quote: item.confirmationQuote, evidenceIds: item.confirmationEvidenceIds }) : undefined;
      const confirmationPosition = confirmation ? historyProofPosition(session, sources, confirmation) : undefined;
      if(item.workStatus!==undefined&&!['planned','in_progress','reported_complete','released','unknown'].includes(String(item.workStatus)))throw new Error("Invalid evolution work status");
      const work = item.workStatus && item.workStatus!=="unknown" ? provenance({quote:item.workQuote,evidenceIds:item.workEvidenceIds}) : undefined;
      if(work&&['in_progress','reported_complete','released'].includes(String(item.workStatus))&&!work.evidenceIds.some(id=>sources.some(source=>source.id===id&&source.role==="user"&&supports(id,work.quote)&&statementEvidence(source.text,work.quote).report)))throw new Error("Reported progress or release requires an original user report");
      const directUser = proof.evidenceIds.some(id => sources.some(source => source.id === id && source.role === "user" && supports(id, proof.quote) && statementEvidence(source.text,proof.quote).decision));
      const laterUser = confirmation && confirmation.evidenceIds.some(id => sources.some(source => source.id === id && source.role === "user" && supports(id, confirmation.quote) && proof.evidenceIds.some(proofId=>sources.some(proposal=>proposal.id===proofId&&confirmsProposal({content:source.text,conversationId:source.conversationId,messageIndex:source.messageIndex},confirmation.quote,{content:proposal.text,conversationId:proposal.conversationId,messageIndex:proposal.messageIndex,id:proposal.messageId,role:proposal.role,partial:proposal.partial},proof.quote))))) && (compareHistoryPositions(confirmationPosition,position) ?? -1) > 0;
      if (confirmation && !laterUser) throw new Error("History confirmation needs a later original user decision");
      if (item.decisionStatus === "confirmed" && (item.status !== "documented" || !(directUser || laterUser))) throw new Error("Confirmed history needs an original user decision");
      if (item.version && !normalized(proof.quote).toLowerCase().includes(normalized(item.version).toLowerCase())) throw new Error("Project version has no literal evidence");
      const beforeProof = item.before ? provenance({ quote: item.beforeQuote, evidenceIds: item.beforeEvidenceIds }) : { quote: "", evidenceIds: [] as string[] };
      const details = (items: unknown): ProjectHistoryDetail[] => {
        if (!Array.isArray(items) || items.length > 6) throw new Error("Invalid version changes");
        return items.map(detail => {
          if (!object(detail) || !clean(detail.text, 240)) throw new Error("Invalid version change");
          return { text: detail.text.trim(), ...provenance(detail) };
        });
      };
      const additions = item.additions === undefined ? undefined : details(item.additions);
      const modifications = item.modifications === undefined ? undefined : details(item.modifications);
      const reasonProof = item.reasonQuote !== undefined ? item.reason ? provenance({ quote: item.reasonQuote, evidenceIds: item.reasonEvidenceIds }) : { quote: "", evidenceIds: [] as string[] } : undefined;
      // An invalid optional pointer is dropped; it never rejects the event.
      // Wire "relation" on first reading; saved "pendingRelation" when a cache is revalidated.
      const wire = object(item.relation) ? item.relation : object(item.pendingRelation) ? item.pendingRelation : undefined;
      const link = wire && ["replaces", "narrows", "supplements", "coexists", "rejects"].includes(String(wire.kind)) ? wire : undefined;
      const target = link?.target ?? link?.targetId;
      const targetId = typeof target === "string" && target.trim() && target.length <= 100 ? target.trim() : undefined;
      const hint = link && typeof link.hint === "string" && link.hint.trim() && link.hint.length <= 200 ? link.hint.trim() : undefined;
      const pendingRelation: ProjectHistoryRelationHint | undefined = link ? { kind: link.kind as ProjectHistoryRelationKind, ...(targetId ? { targetId } : {}), ...(hint ? { hint } : {}) } : undefined;
      const dates = proof.evidenceIds.map(id => sources.find(source => source.id === id)?.discussedAt).filter((date): date is number => typeof date === "number" && Number.isFinite(date) && date > 946684800000);
      return { id: identity(item), title: item.title.trim(), version: item.version.trim(), before: item.before.trim(), after: item.after.trim(), reason: item.reason.trim(), status: item.status as ProjectHistoryEvent["status"], ...proof, beforeQuote: beforeProof.quote, beforeEvidenceIds: beforeProof.evidenceIds,
        ...(item.recordKind?{recordKind:item.recordKind as ProjectHistoryEvent["recordKind"]}:{}), ...(typeof item.area === "string" ? { area: item.area.trim() } : {}), ...(item.changeKind ? { changeKind: item.changeKind as ProjectHistoryEvent["changeKind"] } : {}), ...(item.decisionStatus ? { decisionStatus: item.decisionStatus as ProjectHistoryEvent["decisionStatus"] } : {}),
        ...(position ? { position } : {}), ...(confirmation ? { confirmationQuote: confirmation.quote, confirmationEvidenceIds: confirmation.evidenceIds, confirmationPosition } : {}),
        ...(item.workStatus?{workStatus:item.workStatus as ProjectHistoryEvent["workStatus"]}:{}), ...(work?{workQuote:work.quote,workEvidenceIds:work.evidenceIds}:{}),
        ...(additions ? { additions } : {}), ...(modifications ? { modifications } : {}), ...(reasonProof ? { reasonQuote: reasonProof.quote, reasonEvidenceIds: reasonProof.evidenceIds } : {}), ...(dates.length ? { discussedAt: Math.min(...dates) } : {}), ...(pendingRelation ? { pendingRelation } : {}) };
    });
  })();
  return { summary: value.summary.trim(), modules, relations, decisions: records(value.decisions, "decisions"), constraints: records(value.constraints, "constraints"), actions: records(value.actions, "actions"), ...(value.questions !== undefined ? { questions: records(value.questions, "questions") } : {}), ...(history ? { history } : {}), signature: projectStateSignature(session), generatedAt: Date.now(), basis: "organized" };
}

/** Manual maintenance is separate from AI output, including records removed by a later analysis. */
export function projectStateModel(session: FocusSession) {
  const state = session.projectState;
  if (!state) return undefined;
  const stale = state.signature !== projectStateSignature(session);
  const decisionsStale = stale || Boolean(state.partSignatures?.decisions && state.partSignatures.decisions !== projectStateSignature(session));
  const architectureStale = stale || Boolean(state.partSignatures?.architecture && state.partSignatures.architecture !== projectStateSignature(session));
  const personal = session.projectMaintenance;
  const modules = state.modules.map(module => {const stored=personal?.modules?.[module.id],edited=Boolean(stored&&moduleSignature(stored)!==moduleSignature(module));return {...(stored??module),quote:edited?"":module.quote,evidenceIds:edited?[] as string[]:module.evidenceIds,userEdited:edited,missing:false,changed:stored?.basisSignature!==undefined&&stored.basisSignature!==moduleSignature(module)};});
  for (const module of Object.values(personal?.modules ?? {})) if (!modules.some(item => item.id === module.id)) modules.push({ ...module, quote: "", evidenceIds: [] as string[], userEdited: true, missing: true, changed: false });
  const editedIds = new Set(modules.filter(module => module.userEdited).map(module => module.id));
  const changedRelations = state.relations.filter(edge => editedIds.has(edge.from) || editedIds.has(edge.to));
  return { ...state, relations: state.relations.filter(edge => !editedIds.has(edge.from) && !editedIds.has(edge.to)), pendingRelations: [...(state.pendingRelations ?? []), ...changedRelations.map(edge => ({ ...edge, reason: "模块已有个人修改，历史关系待核对" }))], stale, decisionsStale, architectureStale, accepted: !stale && personal?.acceptedSignature === projectVersionSignature(state), modules,
    decisions: [...state.decisions.filter(item => !personal?.decisions?.[item.id]?.hidden).map(item => ({ ...item, text:personal?.decisions?.[item.id]?.text ?? item.text, userEdited:personal?.decisions?.[item.id]?.text !== undefined && personal.decisions[item.id].text !== item.text, confirmed: !decisionsStale && (!item.sourceBasisSignature||item.sourceBasisSignature===projectStateSignature(session)||personal?.decisions?.[item.id]?.confirmationSignature===projectStateSignature(session)) && (personal?.decisions?.[item.id]?.basisText ?? personal?.decisions?.[item.id]?.text) === item.text && personal?.decisions?.[item.id]?.confirmed === true })), ...Object.entries(personal?.decisions??{}).filter(([id,item])=>!item.hidden&&!state.decisions.some(record=>record.id===id)).map(([id,item])=>({id,text:item.text,reason:"",status:"proposal" as const,quote:"",evidenceIds:[],confirmed:item.confirmed,userEdited:true}))],
    constraints: [...state.constraints.filter(item => !personal?.constraints?.[item.id]?.hidden).map(item => ({...item,text:personal?.constraints?.[item.id]?.text ?? item.text,userEdited:Boolean(personal?.constraints?.[item.id])})), ...Object.entries(personal?.constraints??{}).filter(([id,item])=>!item.hidden&&!state.constraints.some(record=>record.id===id)).map(([id,item])=>({id,text:item.text,reason:"",status:"proposal" as const,quote:"",evidenceIds:[],userEdited:true}))],
    actions: [...state.actions.map(item => ({ ...item, done: !stale && personal?.actions?.[item.id]?.text === item.text && personal.actions[item.id].done === true, personal: false })),
      ...Object.entries(personal?.actions ?? {}).filter(([id]) => !state.actions.some(item => item.id === id)).map(([id, item]) => ({ id, text: item.text, reason: "", status: "proposal" as const, quote: "", evidenceIds: [], done: item.done, personal: true }))],
  };
}

export function projectStateChanges(previous: FocusSession, next: FocusSession) {
  const before = previous.projectState, after = next.projectState;
  if (!before || !after || after.signature !== projectStateSignature(next)) return undefined;
  const same = (a: ProjectModule, b: ProjectModule) => JSON.stringify([a.title, a.layer, a.purpose, a.inputs, a.outputs, a.status]) === JSON.stringify([b.title, b.layer, b.purpose, b.inputs, b.outputs, b.status]);
  return { added: after.modules.filter(item => !before.modules.some(old => old.id === item.id)), changed: after.modules.filter(item => before.modules.some(old => old.id === item.id && !same(old, item))), removed: before.modules.filter(item => !after.modules.some(nextItem => nextItem.id === item.id) || after.modules.find(nextItem => nextItem.id === item.id)?.status === "superseded" && item.status !== "superseded"),
    decisions: after.decisions.filter(item => !before.decisions.some(old => old.id === item.id && old.text === item.text && old.status === item.status)),
    constraints: after.constraints.filter(item => !before.constraints.some(old => old.id === item.id && old.text === item.text && old.status === item.status)),
    questions: after.questions?.filter(item => !before.questions?.some(old => old.id === item.id && old.text === item.text && old.status === item.status)) ?? [],
    relationsChanged: JSON.stringify(before.relations.map(edge => [edge.from, edge.to, edge.label, edge.kind])) !== JSON.stringify(after.relations.map(edge => [edge.from, edge.to, edge.label, edge.kind])) };
}
