/** Chinese ordinals as numbers, for steps labelled 第一版, 第二步, 第三阶段. */
const ORDINALS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const ORDINAL_LABEL = /^第([一二三四五六七八九十]|\d{1,2})(版|步|阶段|期|轮|周|个月|部分)$/u;
const MARKER_ONLY = /^(\s*)(\d+\.|[-*+])\s*$/u;
const LABELLED = /^\s*(?:\d+\.|[-*+])\s+\*\*([^*\n]{1,16})\*\*\s*[：:]/u;

const ordinalOf = (label: string) => {
  const match = label.match(ORDINAL_LABEL);
  if (!match) return undefined;
  const value = /^\d+$/u.test(match[1]) ? Number(match[1]) : ORDINALS.indexOf(match[1]);
  return value > 0 ? { value, unit: match[2], digits: /^\d+$/u.test(match[1]) } : undefined;
};
const labelFor = (value: number, unit: string, digits: boolean) => `第${digits ? value : ORDINALS[value] ?? value}${unit}`;

/** A list item left as its marker alone: 「1. **第一版**：…」「2.」「3. **第三版**：…」, the confirmed second version's text
 * gone from the list while its units still stood. Between two items labelled in order, the missing label is known, and a
 * cited unit telling it (「……；第二版增加Agent动态状态、10分钟守护……；第三版……」) gives it back. Any other bare marker goes.
 * Returns the text and, for each item given back, the units it came from. */
export function restoredEmptyItems(text: string, statements: Array<{ id: string; statement: string }>): { text: string; restored: Array<{ text: string; unitIds: string[] }> } {
  if (!text.split("\n").some(line => MARKER_ONLY.test(line))) return { text, restored: [] };
  const lines = text.split("\n"), restored: Array<{ text: string; unitIds: string[] }> = [];
  const labelAt = (at: number) => lines[at]?.match(LABELLED)?.[1]?.trim();
  const kept = lines.flatMap((line, at) => {
    const marker = line.match(MARKER_ONLY);
    if (!marker) return [line];
    const before = ordinalOf(labelAt(at - 1) ?? ""), after = ordinalOf(labelAt(at + 1) ?? "");
    const guide = before ?? after, value = before ? before.value + 1 : after ? after.value - 1 : 0;
    if (!guide || value < 1 || before && after && (after.value !== value + 1 || after.unit !== before.unit)) return [];
    const label = labelFor(value, guide.unit, guide.digits);
    for (const { id, statement } of statements) {
      const told = statement.match(new RegExp(`${label}[：:，,]?\\s*([^；;。\\n]{2,})`, "u"))?.[1]?.trim();
      if (!told) continue;
      const said = `${told.replace(/[，,、]$/u, "")}。`;
      restored.push({ text: said, unitIds: [id] });
      return [`${marker[1]}${marker[2]} **${label}**：${said}`];
    }
    return [];
  });
  return { text: kept.join("\n"), restored };
}

/** One sentence telling ordered items with one left out: 「分三版迭代：第一版保留原成长区并适配AI流程，第三版加入自动分组……」,
 * where the cited unit tells 第一版, 第二版 and 第三版. The item left out goes back before the one after it, in the unit's
 * words, joined as the sentence joins its items. Only a gap inside a run the sentence lists (its items joined by ，；、)
 * is filled, and only from a unit telling both the missing item and the one after it. */
export function restoredSkippedOrdinals(text: string, statements: Array<{ id: string; statement: string }>): { text: string; restored: Array<{ text: string; unitIds: string[] }> } {
  const restored: Array<{ text: string; unitIds: string[] }> = [];
  const LABEL = /第([一二三四五六七八九十]|\d{1,2})(版|步|阶段|期|轮)/gu;
  const sentences = text.split(/(?<=[。！？\n])/u).map(sentence => {
    const found = [...sentence.matchAll(LABEL)].map(match => ({ at: match.index!, label: match[0], ...ordinalOf(match[0])! })).filter(item => item.value);
    if (found.length < 2) return sentence;
    let out = sentence;
    for (let index = found.length - 1; index > 0; index--) {
      const [before, after] = [found[index - 1], found[index]];
      if (after.unit !== before.unit || after.value !== before.value + 2) continue;
      const joint = out.slice(0, out.indexOf(after.label, before.at + before.label.length)).match(/([，,；;、])\s*$/u)?.[1];
      if (!joint) continue;
      const label = labelFor(before.value + 1, after.unit, after.digits);
      for (const { id, statement } of statements) {
        if (!statement.includes(after.label)) continue;
        const told = statement.match(new RegExp(`${label}[：:，,]?\\s*([^；;。\\n]{2,})`, "u"))?.[1]?.trim().replace(/[，,、]$/u, "");
        if (!told) continue;
        const at = out.indexOf(after.label, before.at + before.label.length);
        out = `${out.slice(0, at)}${label}${told}${joint}${out.slice(at)}`;
        restored.push({ text: `${label}${told}`, unitIds: [id] });
        break;
      }
    }
    return out;
  });
  return { text: sentences.join(""), restored };
}

/** A body without subtopic headings that head nothing: 「### 国内环境对比」 stood alone before the chapter's end. */
export function withoutEmptyHeadings(body: string): string {
  const parts = body.split(/\n(?=### )/u), kept = parts.filter(part => !/^### [^\n]+\s*$/u.test(part));
  return kept.length === parts.length ? body : kept.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}
