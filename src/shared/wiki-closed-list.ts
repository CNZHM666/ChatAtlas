import type { WikiUserAnswer } from "./wiki-knowledge";

const compact = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s*`“”「」"']/gu, "");

/** A saved choice can establish the size of the exact list in its question. */
export function wikiClosedListChoice(answer: WikiUserAnswer) {
  const selection = answer.answer.normalize("NFKC").trim();
  const count = selection.match(/^(?:仅|只)限(?:于)?(?:上面|上述|列出)(?:的)?\s*(\d+)\s*(?:种|项|个)(?:[^，。；;!?！？\n]{0,14})[。.]?$/u)?.[1]
    ?? selection.match(/^only (?:the )?(\d+) listed (?:items?|components?|options?|entries)[.!]?$/iu)?.[1];
  if (!count || !answer.optionId) return;
  const question = answer.question.normalize("NFKC");
  const list = question.match(/^(.{2,70}?)\s*是否[^？?\n]{0,22}?除\s*(.+?)\s*(?:以外|之外)(?:的)?其他/iu)
    ?? question.match(/^(?:does |should )?(.{2,70}?)\s+(?:include|contain)\b[^?\n]{0,32}?\bother than\s+(.+?)\s*\??$/iu);
  if (!list) return;
  const names = list[2].split(/\s*(?:、|,|\band\b)\s*/iu).map(name => name.trim()).filter(Boolean);
  const items = names.map(compact);
  if (items.length < 2 || items.length !== Number(count) || new Set(items).size !== items.length) return;
  return { count, topic: list[1].trim(), items, names, selection };
}

type ClosedList = NonNullable<ReturnType<typeof wikiClosedListChoice>>;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const members = (choice: ClosedList) => choice.items.map(escape).join("(?:、|,|和|及|and|,and)");

/** A writer sometimes drops the topic and count after a sourced kit rule.
 * Accept only a complete standalone restatement of exactly the selected members. */
export function wikiRestatesClosedList(text: string, choice: ClosedList) {
  const marker = "(?:(?:该|此)(?:套件|清单|列表|目录)|(?:this|the)(?:kit|list|catalog)|" + escape(compact(choice.topic)) + ")";
  return new RegExp("^" + marker + "(?:仅限|只限)(?:于)?(?:列出|上述|上面)(?:的)?(?:组件|元件|选项|项目|内容)?[:：]" + members(choice) + "[。.!！]?$", "iu").test(compact(text));
}

export function wikiClosedListStatement(choice: ClosedList) {
  const zh = /\p{Script=Han}/u.test(choice.selection);
  return zh ? `${choice.topic}${/[\w]$/u.test(choice.topic) ? " " : ""}${choice.selection}：${choice.names.join("、")}。`
    : `${choice.topic} includes ${choice.selection.toLowerCase()}: ${choice.names.join(", ")}.`;
}

/** Expand only a leading, explicitly abbreviated subset of the recorded
 * choice. The row name and cardinality must identify the same list. */
export function wikiRepairClosedListCell(cell: string, rowLabel: string, answer: WikiUserAnswer) {
  const choice = wikiClosedListChoice(answer);
  if (!choice) return;
  const topic = compact(choice.topic).replace(/^(?:预定义的|预设的|上述|the(?:predefined|listed)?)/u, "");
  if (topic.length < 3 || !compact(rowLabel).includes(topic)) return;
  const match = cell.match(/((?:仅限|只限)\s*)([^()（）\n]+?)\s*等\s*(\d+)\s*(种|项|个)((?:(?:预定义|预设|上述|列出)(?:的)?)?(?:组件|元件|选项|项目|条目|模块|工具)?)(?=[）)]|$)/u);
  if (!match || match[3] !== choice.count) return;
  const prefix = match[2].split(/\s*[、,，]\s*/u).map(compact);
  if (!prefix.length || prefix.length >= choice.items.length || !prefix.every((name, index) => name === choice.items[index])) return;
  return cell.replace(match[0], () => `${match[1]}${choice.count}${match[4]}${match[5]}：${choice.names.join("、")}`);
}

export function wikiStatesClosedList(text: string, choice: NonNullable<ReturnType<typeof wikiClosedListChoice>>, finalList = false) {
  const words = compact(text);
  const topic = compact(choice.topic).replace(/^(?:预定义的|预设的|上述|the(?:predefined|listed)?)/u, "");
  if (topic.length < 2 || !words.includes(topic)) return false;
  const list = members(choice);
  const amount = choice.count + "(?:种|项|个|items?|components?|options?|entries)";
  const assertion = "(?:(?:包括|包含|仅限|分别为|[:：])" + list + "(?:(?:这|共)?" + amount + ")|"
    + amount + "(?:[\\p{L}]{0,12})?[:：]" + list + "(?![、,]))";
  return new RegExp(assertion + (finalList ? "[。.!！]?$" : ""), "iu").test(words);
}
