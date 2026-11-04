/** IM JSON uses string-encoded int64 values and may encode boolean scalars as
 * 0/1. Keep that compatibility at the platform boundary, not in the queue. */
type Row = Record<string, unknown>;
function record(value: unknown, field: string): Row {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { /* Report the field, never the payload. */ }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`豆包响应缺少有效的 ${field}，请刷新豆包网页后重试。`);
  return value as Row;
}

export function doubaoHistoryBody(value: unknown, field: "pull_recent_conv_chain_downlink_body" | "pull_singe_chain_downlink_body"): Row {
  let envelope = record(value, "response");
  for (let depth = 0; depth < 3; depth++) {
    for (const key of ["status_code", "code"]) {
      const code = envelope[key];
      if ((typeof code === "number" || typeof code === "string" && /^-?\d+$/u.test(code)) && Number(code) !== 0) {
        const safeCode = String(code).slice(0, 24);
        throw Error(`豆包拒绝历史读取（错误码 ${safeCode}），请刷新豆包网页后重试。`);
      }
    }
    if (envelope.downlink_body !== undefined) return record(record(envelope.downlink_body, "downlink_body")[field], field);
    if (envelope.data === undefined) break;
    envelope = record(envelope.data, "data");
  }
  throw Error("豆包响应缺少 downlink_body，尚未读取到历史数据，请刷新豆包网页后重试。");
}

export function doubaoRows(value: unknown, field: string): Row[] {
  if (!Array.isArray(value)) throw Error(`豆包响应的 ${field} 不是列表，未将结果标为完整。`);
  return value.map(item => record(item, field));
}

export function doubaoHasMore(value: unknown): boolean {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  throw Error("豆包响应缺少有效的 has_more 分页标记，未将结果标为完整。");
}

export function doubaoInteger(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value).toString();
  throw Error(`豆包响应的 ${field} 缺失或精度不可靠，未继续翻页。`);
}

export function doubaoNext(page: Row, cursorField: string): string | undefined {
  if (!doubaoHasMore(page.has_more ?? page.hasMore)) return undefined;
  return doubaoInteger(page[cursorField], cursorField);
}
