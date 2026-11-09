/** The words naming the phase or version a statement is about, in one place. Each check kept its own list, and one
 * knew 「第一版」 but not 「首版」, another 「本阶段」 but not 「当前阶段」. A word added here reaches every check.
 * Sources have no capture groups; join them into a pattern of your own. */

/** The phase or round now under way: 「本阶段」「当前阶段」「本轮」「本次迭代」. */
export const ITERATION_ZH = "本阶段|此阶段|当前阶段|现阶段|本轮|本次迭代|当前迭代|前期|初期";
export const ITERATION_EN = String.raw`\bthis (?:phase|iteration|sprint|round)\b|\bcurrent (?:phase|iteration)\b`;
/** The first version, by name: 「第一版」「首版」. */
export const FIRST_VERSION_ZH = "第一版|首版";
export const FIRST_VERSION_EN = String.raw`\bfirst (?:version|release)\b`;
/** A version named by number or as the MVP: 「V0.1」「v1」「MVP」. */
export const VERSION_NAME = String.raw`\bV\d+(?:\.\d+)*\b|\bMVP\b`;

/** The Chinese phase and version words, and versions by name. */
export const PHASE_ZH = `${ITERATION_ZH}|${FIRST_VERSION_ZH}|${VERSION_NAME}`;
/** A text naming the current phase or a version, in Chinese or English. */
export const PHASE = new RegExp(`${PHASE_ZH}|${ITERATION_EN}|${FIRST_VERSION_EN}`, "iu");
