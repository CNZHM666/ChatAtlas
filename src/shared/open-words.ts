/** The words saying a choice is not made yet, in one place. Two checks kept copies, one word for word the same, others
 * knew 「未定」 but not 「两案并存」 or 「仍在讨论」: the long break and the two popup widths read as decided in one check
 * and open in the next. A word added here reaches every check. */

/** 「未定」「待定」「尚未确定」「还没想好」「两案并存」「仍在讨论」. 「尚未」 alone is not among them: 「尚未实现」 says what
 * is not built, not what is not chosen. 「并存」 only of options: 「这些不同时间点的数值并存」 told figures, and was listed as an
 * open question. */
export const OPEN_ZH = "未定|待定|待确认|待决定|未决定|(?:尚|有)待(?:决定|确定|确认|明确|讨论)|未最终|暂不决定|尚未(?:决定|确定|明确|定案|确认|最终)|还没(?:有)?(?:想好|决定|确定|确认|定)|(?:先|暂|暂时)不定|先不决定|仍在讨论|仍需确认|两案|(?:方案|版本|做法|说法|设计|选项|两种|几种|两个|两套)[^，。；;,]{0,6}并存";
export const OPEN_EN = String.raw`\bundecided\b|\bnot (?:yet )?decided\b|\b(?:remains?|still|leave it) open\b|\bremains? an open (?:\w+ )?(?:decision|question)\b|\bopen (?:product |design |technical )?(?:decision|question)\b|\bpending\b|\bTBD\b`;

/** A text saying a choice is still to make, in Chinese or English. */
export const UNDECIDED = new RegExp(`${OPEN_EN}|${OPEN_ZH}`, "iu");
