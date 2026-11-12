/** When something last changed, as a reader says it on a list: 今天, 昨天, 3 天前, then the date. */
export function relativeDay(time: number, zh: boolean, now = Date.now()): string {
  const start = (value: number) => { const day = new Date(value); day.setHours(0, 0, 0, 0); return day.getTime(); };
  const days = Math.round((start(now) - start(time)) / 86_400_000);
  if (days <= 0) return zh ? "今天" : "Today";
  if (days === 1) return zh ? "昨天" : "Yesterday";
  if (days < 7) return zh ? `${days} 天前` : `${days} days ago`;
  const date = new Date(time), sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(zh ? "zh-CN" : "en", sameYear ? { month: "numeric", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" });
}
