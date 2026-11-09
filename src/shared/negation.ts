/** The words saying something is left out or ruled out, in one place. Each check used to keep its own list: one knew
 * 「不做」 but not 「不引入」, and two key decisions saying the same thing ("不引入服务器……不再将云同步纳入开发范围",
 * "不做数据云同步") were listed apart. A word added here reaches every check. */

/** Verbs a scope leaves a feature out with (「不引入服务器」「暂不开发」「禁止加入」). Longer ones first, so 「不包括」 is never
 * read as 「不包」. 「禁止扩展至 3 个」 limits a count and leaves nothing out. */
const SCOPE_VERBS = "开发|实现|包含|包括|提供|支持|引入|进行|加入|纳入|接入|上线|涉及|考虑|扩展(?!\\s*(?:至|到)?\\s*\\d)|做";

/** A word leaving the object after it out of scope, as a regex source with no capture groups: 不做, 暂不开发, 不再提供,
 * 不予支持, 禁止引入, 暂缓, 排除. Read the object after it with a group of your own. */
export const LEAVES_OUT = `(?:(?:暂不|不再|不予|不|严禁|禁止)(?:${SCOPE_VERBS})|暂缓(?:开发|实现)?|暂不|禁止|严禁|排除了?)`;

/** A table cell or label that is only such a word ("| 登录功能 | 不引入 |"). */
export const LEFT_OUT_LABEL = new RegExp(`^(?:明确|严格)?${LEAVES_OUT}$`, "u");

/** Words starting with 不 that rule nothing out: 「不同」「不断」「不仅」, or bound a number 「不超过 3 个」. This list is
 * short and closed, unlike the verbs a negation can take. */
const NOT_NEGATING = "同|断|仅|过|错|少|久|管|论|如|足|但|然|妨|止|料|禁|是|一样|超过|低于|高于|少于|多于|大于|小于";

/** A Chinese text ruling something out, whatever the verb: 「不引入」「不再纳入」「绝不使用」「禁止」「避免」「无需」. For
 * telling whether a text rules out; to read what it leaves out, use LEAVES_OUT. */
export const RULES_OUT_ZH = new RegExp(`不(?!(?:${NOT_NEGATING}))\\p{Script=Han}|勿|禁止|严禁|避免|排除|取消|无需|暂缓`, "u");
