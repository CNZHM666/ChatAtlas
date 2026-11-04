import type { FocusSection } from "../shared/focus-session";
import { understandingResponsibility } from "./understanding-model";
import { comparisonTable } from "./understanding-presentation";
import { reviewLead } from "./review-presentation";

/** Read existing explanations; never infer missing responsibilities from a title. */
export function understandingSummary(point: FocusSection): string {
  const responsibility = reviewLead(understandingResponsibility(point), 2);
  if (responsibility && responsibility !== point.title.trim()) return responsibility;
  const body = point.body.replace(comparisonTable(point.body) ?? "\u0000", "").replace(/~~~[\s\S]*?~~~/gu, "");
  return reviewLead(body, 2);
}
