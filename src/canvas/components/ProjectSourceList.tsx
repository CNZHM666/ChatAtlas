import { FileText } from "lucide-react";
import type { Conversation } from "../../shared/types";
import { platformGroups, platformName } from "../../shared/platforms";
import { AIPlatformIcon } from "./AIPlatformIcon";

type Source = { id: string; title: string; platform: string };

/** A project's source conversations. From several AIs they are grouped under each AI, so a source is found by where it
 * was discussed; from one AI they stay one list. */
export function ProjectSourceList({ ids, conversations, fallbackTitle, zh, onOpen }: { ids: readonly string[]; conversations: readonly Conversation[]; fallbackTitle: (id: string) => string | undefined; zh: boolean; onOpen: (id: string) => void }) {
  const sources: Source[] = ids.map(id => { const conversation = conversations.find(item => item.id === id); return { id, title: conversation?.title ?? fallbackTitle(id) ?? (zh ? "来源对话" : "Source conversation"), platform: conversation?.platform ?? "other" }; });
  const item = (source: Source) => <button type="button" key={source.id} className="outline-item outline-source-item" onClick={() => onOpen(source.id)}><FileText size={18} aria-hidden="true" /><strong>{source.title}</strong></button>;
  const groups = platformGroups(sources);
  if (groups.length < 2) return <>{sources.map(item)}</>;
  return <>{groups.map(group => <section key={group.platform} className="outline-source-group" aria-label={platformName(group.platform, zh ? "zh-CN" : "en")}>
    <h3><AIPlatformIcon platform={group.platform} /><span>{platformName(group.platform, zh ? "zh-CN" : "en")}</span><small>{group.items.length}</small></h3>
    {group.items.map(item)}
  </section>)}</>;
}
