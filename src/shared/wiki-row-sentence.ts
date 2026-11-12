// A table row told as text, one way everywhere. Three places turned a row into text (a table the writer could not show
// as one, a row moved to the earlier versions, a table of versions left with one row), each its own way, and two wrote
// a form: 「日活 (DAU)：约40；核心用户数：-；备注：……」. Every one of them goes through here.

/** A column holding whatever the others leave ("其他", "备注", "留存/其他指标"): its name tells the reader nothing. */
const CATCH_ALL = /\/|其他|其它|备注|说明|补充/u;
/** A cell the discussion gave no value. */
const EMPTY = /^(?:[-—–]|无|暂无|n\/a|none)?$/iu;

/** The fields of a row as text: an empty cell left out, in Chinese a catch-all column's name left off, a short figure
 * right after its column's name ("日活 (DAU)约40"), the rest "名称：值", joined by "；" and ending with a full stop when any
 * column is named or the last cell ended with one. A field with no name is its value alone. */
export function rowFields(names: Array<string | undefined>, values: string[], zh: boolean): string {
  let named = false;
  const stopped = zh && /[。]$/u.test(values[values.length - 1]?.trim() ?? "");
  const fields = values.flatMap((raw, index) => {
    const value = zh ? raw.trim().replace(/[。；;]+$/u, "") : raw.trim(), name = names[index]?.trim();
    if (EMPTY.test(value)) return [];
    if (!name) return [value];
    named = true;
    if (!zh) return [`${name}: ${value}`];
    if (CATCH_ALL.test(name)) return [value];
    return [value.length <= 8 && /\d/u.test(value) ? `${name}${value}` : `${name}：${value}`];
  });
  const text = fields.join(zh ? "；" : "; ");
  return zh && (named || stopped) && text && !/[。！？]$/u.test(text) ? `${text}。` : text;
}
