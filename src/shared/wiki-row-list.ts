/** A table written as a list of its rows ("- **Quittr**：关键数据或特征: App Store宣称……。; 备注: 依靠……"), in drafts whose
 * writer could not read it as a table: each item its row's name, then each column's name and cell. Read back as the
 * table it was, when the items name their columns in one order. */
export function rowListAsTable(text: string, zh: boolean): string {
  const lines = text.trim().split("\n").filter(line => line.trim());
  if (lines.length < 2) return text;
  const rows = lines.map(line => {
    const item = line.match(/^\s*[-*+]\s+\*\*([^*\n]+)\*\*\s*[：:]\s*(.+)$/u);
    if (!item) return undefined;
    const cells = item[2].split(/\s*[;；]\s*(?=[^:：;；|]{1,12}[:：])/u).map(part => part.match(/^([^:：;；|]{1,12})[:：]\s*(.+)$/u));
    if (cells.some(cell => !cell)) return undefined;
    return { name: item[1].trim(), labels: cells.map(cell => cell![1].trim()), values: cells.map(cell => cell![2].trim().replace(/[;；]$/u, "")) };
  });
  if (rows.some(row => !row)) return text;
  // Rows giving only some of the fields ("主流戒色App：关键数据或现状：多采用买断制", without 备注) are still rows: the list read
  // 「关键数据或现状：…；备注：…」 item after item. The fullest row names the columns; a row naming one it does not is no row of
  // that table, and the items stay a list.
  const labels = rows.reduce((most, row) => row!.labels.length > most.length ? row!.labels : most, [] as string[]);
  const ordered = rows.every(row => row!.labels.every((label, at) => labels.includes(label) && (at === 0 || labels.indexOf(label) > labels.indexOf(row!.labels[at - 1]))));
  // Rows of one field mostly, all under the same label (「- **整体留存率**：数值/状态：26.92%」, one row adding 备注): a table
  // too, when there are three at least.
  const sameField = rows.length >= SAME_FIELD_ROWS && rows.every(row => row!.labels[0] === labels[0]);
  if (labels.length > MAX_FIELDS || rows.filter(row => row!.labels.length >= 2).length < 2 && !sameField || !ordered) return text;
  const cell = (value: string) => value.replace(/\|/gu, "\\|");
  const valueOf = (row: NonNullable<(typeof rows)[number]>, label: string) => { const at = row.labels.indexOf(label); return at < 0 ? "—" : row.values[at]; };
  return [`| ${zh ? "名称" : "Name"} | ${labels.map(cell).join(" | ")} |`, `| ${["---", ...labels.map(() => "---")].join(" | ")} |`, ...rows.map(row => `| ${cell(row!.name)} | ${labels.map(label => cell(valueOf(row!, label))).join(" | ")} |`)].join("\n");
}

/** The most fields a list of rows may give and still read as a table. */
const MAX_FIELDS = 5;
/** Rows of one shared field that still read as a table. */
const SAME_FIELD_ROWS = 3;
