import { LoaderCircle, Sparkles, X } from "lucide-react";
import type { OrganizationPlan } from "../../shared/types";
import { usePreferences } from "../preferences";

export type AutoOrganizeStage = "intro" | "analyzing" | "preview";

export function AutoOrganizePanel({ stage, plan, onAnalyze, onApply, onReview, onClose }: {
  stage: AutoOrganizeStage;
  plan: OrganizationPlan | null;
  onAnalyze: () => void;
  onApply: () => void;
  onReview: () => void;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const automaticCount = plan?.suggestions.reduce((total, item) => total + item.conversationIds.length, 0) ?? 0;
  const reviewCount = plan?.reviewItems.length ?? 0;
  const needsMoreAnalysis = plan?.analysisQuality === "needs-more-analysis";
  return <section className="auto-organize-panel" aria-live="polite" aria-label={t("smartOrganize")}> 
    <button className="auto-organize-close" onClick={onClose} aria-label={t("close")}><X size={16} /></button>
    {stage === "intro" ? <>
      <Sparkles size={18} />
      <h2>{t("smartOrganizeIntroTitle")}</h2>
      <p>{t("smartOrganizeIntroDescription")}</p>
      <button className="primary" onClick={onAnalyze}>{t("previewOrganization")}</button>
    </> : null}
    {stage === "analyzing" ? <div className="auto-organize-analyzing"><LoaderCircle className="spin" size={17} /><h2>{t("analyzingConversations")}</h2><p>{t("analyzingConversationsHint")}</p></div> : null}
    {stage === "preview" && plan ? <>
      <Sparkles size={22} />
      <h2>{t(needsMoreAnalysis ? "organizationPreliminaryTitle" : "organizationPreviewTitle", { count: plan.suggestions.length })}</h2>
      <div className="organization-preview-list">
        {plan.suggestions.map((suggestion) => <div key={suggestion.id}><strong>{suggestion.suggestedTopicTitle}</strong><b>{suggestion.conversationIds.length}</b></div>)}
      </div>
      <p className="organization-summary">{needsMoreAnalysis ? t("organizationLowCoverage", { percent: Math.round((plan.coverage?.ratio ?? 0) * 100) }) : t("organizationPreviewSummary", { automatic: automaticCount, review: reviewCount })}</p>
      <div className="auto-organize-actions">{needsMoreAnalysis ? <><button className="primary" onClick={onAnalyze}>{t("continueAnalysis")}</button><button onClick={onReview}>{t("viewCurrentSuggestions")}</button></> : <><button className="primary" onClick={onApply}>{t("applyToCanvas")}</button>{reviewCount ? <button onClick={onReview}>{t("adjustCategories")}</button> : null}</>}</div>
    </> : null}
  </section>;
}
