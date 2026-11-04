/** Tags use stage headings and uniquely matched milestones, never the last stage's position. */
export function discussionStageTags(title: string, phase: string | undefined, zh: boolean): string[] {
  const tags: string[] = [];
  const text = `${title} ${phase ?? ""}`;
  for (const match of text.matchAll(/\bV\d+(?:\.\d+){1,3}\b|\bMilestone\s*\d+\b/giu)) tags.push(match[0]);
  if (!/是否|未定|未确认|疑问|尚未|非最终|不是最终|并非|not\s|draft|question/iu.test(text) && /最终版本|最终方案|定稿|final version|final plan/iu.test(text)) tags.push(zh ? "最终版本" : "Final version");
  const topics: Array<[RegExp, string, string]> = [
    [/BYOK|安全|密钥|security/iu, "安全机制", "Security"],
    [/采购|缺件|procurement|shopping/iu, "采购流程", "Procurement"],
    [/验证|校验|硬件闭环|实物|测试|validation|validator|testing/iu, "验证与测试", "Validation"],
    [/\bUI\b|界面|工作台|canvas\s*设计|体验|interface|experience/iu, "界面与体验", "User experience"],
    [/架构|分层|architecture/iu, "架构设计", "Architecture"],
    [/定位|壁垒|positioning/iu, "产品定位", "Positioning"],
    [/里程碑|路线|计划|milestone|roadmap/iu, "开发计划", "Roadmap"],
  ];
  for (const topic of topics.filter(([pattern]) => pattern.test(text)).slice(0, 2)) tags.push(topic[zh ? 1 : 2]);
  return [...new Set(tags)].slice(0, 4);
}
