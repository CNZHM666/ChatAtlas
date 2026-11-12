// Figures and the days they were said on, read one way for every pass. Each pass used to read figures with its own
// pattern, and one that took a date for figures cut 「（6月14日—7月7日）」 as numbers the point never gave, leaving
// 「其中15个为稳定用户」 behind on its own. A day is never a figure here, in brackets or not.

/** A day or a span of days: 6月14日, 2026年8月18日, 6月14日—7月7日, 6月14—20日. */
const DAY = /(?:\d{4}年)?\d{1,2}月\d{1,2}日(?:\s*[—–\-~～至到]\s*(?:\d{4}年)?(?:\d{1,2}月)?\d{1,2}日)?|\d{4}-\d{1,2}-\d{1,2}/gu;

/** The days a text names, each span whole. */
export function daysIn(text: string): string[] { return text.match(DAY) ?? []; }

/** The text without its days: a bracket holding only days and the words around them (（6月14日—7月7日）, （8月18日反馈）)
 * goes whole, a day elsewhere goes alone. */
export function withoutDays(text: string): string { return text.replace(/[（(][^）)]*\d{1,2}月\d{1,2}日[^）)]*[）)]/gu, "").replace(DAY, ""); }

/** A figure counting time or times, not people or a measure: 30天, 7日留存's 7, 3个月, 5分钟, 2次. 「30日活」 counts users. */
const SPAN_AFTER = /^\s*(?:个)?(?:天|日(?!活)|周|星期|月|年|小时|分钟|分|秒|次|岁)/u;

/** The figures a text gives, never a day; with percent, a percentage keeps its sign (40% is not 40); with counts, a
 * figure counting time or times (30天, 3个月, 2次) is left out: it gives no measure of the product. */
export function figuresIn(text: string, options: { percent?: boolean; counts?: boolean } = {}): string[] {
  const bare = withoutDays(text);
  return [...bare.matchAll(options.percent ? /\d+(?:\.\d+)?%?/gu : /\d+(?:\.\d+)?/gu)]
    .filter(match => !options.counts || !SPAN_AFTER.test(bare.slice((match.index ?? 0) + match[0].length)))
    .map(match => match[0]);
}
