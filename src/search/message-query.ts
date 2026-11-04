/** Local query planning. Identifiers and quoted text stay exact; prose filler is optional. */
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
const filler = new Set("如何 怎样 怎么 做 进行 请 请问 帮 帮我 给我 找 找到 找回 查找 搜索 之前 以前 那个 这个 一下 的 了 呢 吗 我 我们 有没有 是否 可以 能不能 关于 讨论 对话 记录 please find search how to do my previous conversation conversations about the a an is of why did we our was were what that when where can could would you me tell discussed decide decided earlier".split(" "));
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

export function messageSearchTokens(text: string): string[] {
  const normalized = text.normalize("NFKC");
  const words = `${normalized} ${normalized.replace(/([a-z])([A-Z])/gu, "$1 $2")}`.toLocaleLowerCase().match(/[\p{Script=Han}]+|[a-z0-9_$+#./:-]+/gu) ?? [];
  return [...new Set(words.flatMap(word => /^[\p{Script=Han}]+$/u.test(word)
    ? [...word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2)), ...[...segmenter.segment(word)].filter(part => part.isWordLike).map(part => part.segment)]
    : [word, ...word.split(/[_./:-]+/u)].filter(Boolean)))];
}

export interface MessageQuery { terms: string[]; phrases: string[]; search: string }
export function planMessageQuery(query: string): MessageQuery {
  const phrases = [...query.matchAll(/"([^"\n]+)"|“([^”\n]+)”/gu)].map(match => normalize(match[1] ?? match[2]).replace(/\s+/gu, " ").trim()).filter(Boolean);
  const unquoted = query.replace(/"[^"\n]+"|“[^”\n]+”/gu, " ")
    .replace(/有哪些|有什么|是什么|为什么|哪几(?:个|种)|之前讨论过|以前讨论过/gu, " ");
  const words = normalize(unquoted).match(/[\p{Script=Han}]+|[a-z0-9_$+#./:-]+/gu) ?? [];
  const terms = [...new Set(words.flatMap(word => /^[\p{Script=Han}]+$/u.test(word)
    ? [...segmenter.segment(word)].filter(part => part.isWordLike).map(part => part.segment)
    : [word]).filter(word => !filler.has(word)))];
  return { terms, phrases, search: [...terms, ...phrases].join(" ") };
}

function requiredTerms(query: MessageQuery, coverage: number) {
  return Math.max(Math.min(2, query.terms.length), Math.ceil(query.terms.length * Math.max(.5, Math.min(1, coverage))));
}
export function matchesMessageQuery(query: MessageQuery, terms: ReadonlySet<string>, text: string | string[], coverage = 1): boolean {
  const fields = typeof text === "string" ? [text] : text;
  return query.terms.filter(term => terms.has(term)).length >= requiredTerms(query, coverage)
    && query.terms.filter(term => /[a-z0-9_$+#]/iu.test(term)).every(term => terms.has(term))
    && query.phrases.every(phrase => fields.some(field => normalize(field).replace(/\s+/gu, " ").includes(phrase)));
}

/** Intent lookup requires one local passage, not unrelated words anywhere in a message. */
export function matchesNearbyQuery(query: MessageQuery, fields: string[], distance: number, coverage = 1): boolean {
  const needles = [...new Set([...query.terms, ...query.phrases])];
  if (needles.length < 2) return true;
  const required = needles.flatMap((term, i) => query.phrases.includes(term) || /[a-z0-9_$+#]/iu.test(term) ? [i] : []);
  const minimum = requiredTerms(query, coverage) + query.phrases.filter(term => !query.terms.includes(term)).length;
  return fields.some(field => {
    const text = normalize(field).replace(/\s+/gu, " ");
    const hits = needles.flatMap((needle, term) => {
      const positions: { start: number; end: number; term: number }[] = [];
      let start = text.indexOf(needle);
      while (start >= 0) { positions.push({ start, end: start + needle.length, term }); start = text.indexOf(needle, start + Math.max(1, needle.length)); }
      return positions;
    }).sort((a, b) => a.start - b.start);
    const counts = new Map<number, number>(); let left = 0;
    for (let right = 0; right < hits.length; right++) {
      counts.set(hits[right].term, (counts.get(hits[right].term) ?? 0) + 1);
      while (left < right && hits[right].end - hits[left].start > distance) {
        const term = hits[left++].term, count = counts.get(term)! - 1;
        if (count) counts.set(term, count); else counts.delete(term);
      }
      if (counts.size >= minimum && required.every(term => counts.has(term)) && hits[right].end - hits[left].start <= distance) return true;
    }
    return false;
  });
}

/** Exact raw offsets, independent of the length changes caused by NFKC. */
export function messageQueryRange(query: MessageQuery, raw: string): { start: number; end: number } | undefined {
  const needles = [...query.phrases, ...query.terms].sort((a, b) => b.length - a.length);
  const normalized: string[] = [], positions: number[] = [];
  let at = 0;
  for (const char of raw) {
    const part = normalize(char).replace(/\s/gu, " ");
    for (let n = 0; n < part.length; n++) { if (part[n] === " " && normalized.at(-1) === " ") continue; normalized.push(part[n]); positions.push(at); }
    at += char.length;
  }
  const text = normalized.join("");
  for (const needle of needles) {
    const start = text.indexOf(needle);
    if (start >= 0) {
      const last = positions[start + needle.length - 1];
      return { start: positions[start], end: last + (raw.codePointAt(last)! > 0xffff ? 2 : 1) };
    }
  }
  return undefined;
}
