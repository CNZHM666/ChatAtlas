import type { ProjectHistoryEvent } from "./project-state";

const key = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");

/** Names learned from reviewed accounts, not a similarity-based merge of facts. */
export function changeSubjectNames(event: ProjectHistoryEvent): string[] {
  const names=new Map<string,string>();
  for(const name of [event.area ?? "", ...(Array.isArray(event.areaAliases)?event.areaAliases:[])]){
    if(typeof name==="string"&&name.trim()&&name.length<=120&&!names.has(key(name)))names.set(key(name),name.trim());
  }
  return [...names.values()];
}

export function reviewedSubjectAliases(base:ProjectHistoryEvent,...accounts:ProjectHistoryEvent[]):string[]{
  return changeSubjectNames({...base,areaAliases:[...(base.areaAliases??[]),...accounts.flatMap(changeSubjectNames)]}).filter(name=>key(name)!==key(base.area??""));
}

export function sameChangeSubject(a: ProjectHistoryEvent, b: ProjectHistoryEvent): boolean {
  const names = new Set(changeSubjectNames(a).map(key));
  return changeSubjectNames(b).some(name => names.has(key(name)));
}

/** A local projection over saved events. No new store and no changes to historical text. */
export function projectSubjectGroups(events: ProjectHistoryEvent[]): string[][] {
  const groups: string[][] = [];
  for (const event of events) {
    const names = changeSubjectNames(event);
    if (!names.length) continue;
    const matching = groups.filter(group => group.some(name => names.some(other => key(name) === key(other))));
    const combined = [...new Map([...matching.flat(), ...names].map(name => [key(name), name])).values()];
    for (const group of matching) groups.splice(groups.indexOf(group), 1);
    groups.push(combined);
  }
  return groups;
}

export function projectSubjectKey(event: ProjectHistoryEvent, groups: string[][]): string {
  const names = changeSubjectNames(event);
  const group = groups.find(group => group.some(name => names.some(other => key(name) === key(other))));
  return key(group?.[0] ?? event.area ?? "");
}
