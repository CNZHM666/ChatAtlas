/** A knowledge card's recall question, kept in the chapter as a quote under its card: "> **回忆**：question" then the
 * answer. The workbench shows it folded, the answer a click away; the Markdown export, which cannot fold, gathers them
 * at the chapter's end, the questions before the answers. */
export const WIKI_RECALL_LABELS = ["回忆", "Recall"] as const;

/** The quote of one recall question and its answer. */
export function recallQuote(question: string, answer: string, zh: boolean): string {
  const line = (text: string) => text.replace(/\s*\n\s*/gu, " ").trim();
  return `> **${zh ? WIKI_RECALL_LABELS[0] : WIKI_RECALL_LABELS[1]}**${zh ? "：" : ": "}${line(question)}\n>\n> ${line(answer)}`;
}

const QUOTE = /^> \*\*(回忆|Recall)\*\*[：:]\s*([^\n]+)\n>\s*\n> ([^\n]+)$/u;

/** The question and answer of a recall quote, or undefined. */
export function recallOf(block: string): { question: string; answer: string } | undefined {
  const match = block.trim().match(QUOTE);
  return match ? { question: match[2].trim(), answer: match[3].trim() } : undefined;
}

/** A chapter's recall questions moved to its end, numbered, the answers after them: read straight down, an answer under
 * its question is read before it is recalled. A chapter with none is left as it is. */
export function recallAtChapterEnd(body: string, zh: boolean): string {
  const asked: Array<{ question: string; answer: string; card: string }> = [];
  const l = (cn: string, en: string) => zh ? cn : en;
  const kept = body.replace(/^> \*\*(?:回忆|Recall)\*\*[：:][^\n]*\n>\s*\n> [^\n]*$/gmu, (block, at: number) => {
    const recall = recallOf(block);
    if (!recall) return block;
    // Away from its card, a question names it: the card heading above it, without its standing ("· 已会").
    // A card's heading, not an exercise's under it ("#### 练习 1").
    const card = [...body.slice(0, at).matchAll(/^#{2,3}\s+(.+)$/gmu)].at(-1)?.[1].replace(/\s+·\s+[^·]+$/u, "").trim() ?? "";
    asked.push({ ...recall, card });
    return "";
  });
  if (!asked.length) return body;
  return [kept.replace(/\n{3,}/gu, "\n\n").trim(),
    `### ${l("本章回忆题", "Recall")}`, l("先不看上文，试着回答；答案在题目之后。", "Answer from memory first; the answers follow the questions."),
    asked.map((item, index) => `${index + 1}. ${named(item.question, item.card, l)}`).join("\n"),
    `**${l("参考答案", "Answers")}**`, asked.map((item, index) => `${index + 1}. ${item.answer}`).join("\n")].join("\n\n");
}

/** A question away from its card names it, by number when the card has one: "「边界条件处理」容易错在哪里？" under
 * "2.3 边界条件处理" reads "「2.3 边界条件处理」容易错在哪里？"; one naming no card is followed by "（「2.3 边界条件处理」）". */
function named(question: string, card: string, l: (cn: string, en: string) => string): string {
  if (!card) return question;
  const bare = card.replace(/^\d+(?:\.\d+)+\s+/u, "");
  if (question.includes(`「${bare}」`)) return question.replace(`「${bare}」`, `「${card}」`);
  return question.includes(bare) ? question : `${question}${l(`（「${card}」）`, ` (${card})`)}`;
}
