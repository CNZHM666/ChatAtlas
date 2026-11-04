import { Sparkles } from "lucide-react";
import type { KnowledgeProposal } from "../../shared/types";
import { usePreferences } from "../preferences";

export function ProposalActionBar({ proposal, analyzing, onCancel, onApply }: { proposal: KnowledgeProposal | null; analyzing: boolean; onCancel: () => void; onApply: () => void }) {
  const { t } = usePreferences();
  if (analyzing) return null;
  if (!proposal) return null;
  const affectedCanvasCount = new Set([
    ...proposal.canvases.map((canvas) => canvas.id),
    ...proposal.memberships.map((membership) => membership.canvasId),
  ]).size;
  return <div className="proposal-action-bar">
    <span><Sparkles size={15} />{t("canvasCount", { count: affectedCanvasCount })} · {t("conceptCount", { count: proposal.cards.length })} · {t("relationCount", { count: proposal.relations.length })}{proposal.reviewConversationIds.length ? ` · ${t("reviewCount", { count: proposal.reviewConversationIds.length })}` : ""}{proposal.analysisWarnings ? ` · ${t("analysisWarnings", { count: proposal.analysisWarnings })}` : ""}</span>
    <div><button onClick={onCancel}>{t("cancel")}</button><button className="primary" onClick={onApply}>{t("applyAll")}</button></div>
  </div>;
}
