import type { WikiKnowledgeUnit, WikiUnitStatus } from "../shared/wiki-knowledge";

/** What the user reports a part does not do yet (Validator 不检查电压、GPIO 冲突), beside units that describe that part
 * doing it (构建 Compatibility Engine 实时检查电压; tests 覆盖 GPIO 冲突). Told side by side as two current facts, they
 * contradict each other; the report says what holds now, and the others are plans. */
const LACKS = /([A-Za-z][\w-]{1,30}|[一-鿿]{2,8})\s*(?:当前|目前|暂时|还|尚)?(?:不|未|没有)(?:检查|校验|验证|判断|支持|覆盖)([^。；;，,]+)/u;
const DOES = /检查|校验|验证|判断|覆盖|识别/u;
const SPLIT = /[、/，,]|以及|及|和|与|或/u, squeeze = (text: string) => text.replace(/\s+/gu, "");

/** unit id → the user's report of what does not exist yet, for every unit describing it as a capability. */
export function currentCapabilityState(units: WikiKnowledgeUnit[], statuses: Map<string, WikiUnitStatus>): Map<string, string> {
  const reports = units.flatMap(unit => {
    if (unit.evidence.role !== "user" && statuses.get(unit.id) !== "reported") return [];
    const match = unit.statement.match(LACKS);
    if (!match) return [];
    const objects = match[2].split(SPLIT).map(part => part.trim().replace(/^(?:是否|有无)/u, "")).filter(part => part.length >= 2);
    return objects.length ? [{ unit, part: match[1], objects: objects.map(squeeze), text: match[0].trim() }] : [];
  });
  const found = new Map<string, string>();
  for (const report of reports) for (const unit of units) {
    if (unit === report.unit || found.has(unit.id) || !DOES.test(unit.statement) || LACKS.test(unit.statement)) continue;
    // The unit names the same part (Validator), or checks the object itself (实时检查电压), not a rule that only mentions it.
    const text = squeeze(unit.statement), part = report.part.toLowerCase();
    const checks = (object: string) => text.toLowerCase().includes(part) ? text.includes(object) : new RegExp(`(?:${DOES.source})[^。；;，,”"]{0,30}${object.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u").test(text);
    if (report.objects.some(checks)) found.set(unit.id, report.text);
  }
  return found;
}
