import { memoryQueryVariants } from "./memory-query";
import { messageQueryRanges, planMessageQuery } from "./message-query";
import { readableSourceText } from "../shared/source-text-display";
import { sourceQuoteText } from "../shared/source-quote-text";

export function historySearchRanges(query: string, text: string) {
  const plans = memoryQueryVariants(query).map(planMessageQuery);
  return messageQueryRanges({
    terms: [...new Set(plans.flatMap(plan => plan.terms))],
    phrases: [...new Set(plans.flatMap(plan => plan.phrases))],
    search: "",
  }, text);
}

/** Search hits can start halfway through Markdown, so remove orphaned marks
 * as well as the markup the parser can resolve. The stored message is untouched. */
export function historySearchSnippet(raw: string, query: string, limit = 150) {
  const markdown = readableSourceText(raw)
    .replace(/(?:\x60{3,}|~{3,})(?:[\w+-]+(?=\s|$))?/gu, " ")
    .replace(/(?:^|\s)#{1,6}(?=\s)|(?:^|\s)(?:-{3,}|[━─═]{3,}|>{1,3})(?=\s|$)/gu, " ")
    .replace(/<MemoryCite\s*\/?>|\uFFFD+/giu, " ")
    .replace(/([。！？!?])\s+(?=[^。！？!?\n])/gu, "$1\n");
  const text = markdown.split("\n").map(line => sourceQuoteText(line)).join(" ").replace(/\x60+/gu, "").replace(/\s+/gu, " ").trim();
  const prominent = historySearchRanges(query, text)[0];
  const start = text.length > limit ? Math.max(0, (prominent?.start ?? 0) - 18) : 0;
  const end = Math.min(text.length, Math.max(start + limit, prominent?.end ?? 0));
  return (start ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}
