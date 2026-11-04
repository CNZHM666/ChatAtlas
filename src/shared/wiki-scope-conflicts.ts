import type {FocusSection} from "./focus-session";

/** An explicit contradiction in the directory's OWN description, not a keyword
 * classifier over source content. It only prompts review; it never excludes or
 * changes a chapter. Legitimate attributed references can be kept by the user. */
export function wikiScopeConflictChapters(sections:FocusSection[]):FocusSection[]{
 return sections.filter(section=>!section.userEdited&&!section.origin&&(
  /(?:本|该|当前)?项目[之以]外|不属于(?:本|该|当前)项目|非本项目|\boutside (?:this|the|current) project\b|\bunrelated (?:discussions?|material|topics?)\b/iu.test(section.wikiQuestion??"")||
  /^(?:旁支(?:与参考)?|项目外(?:讨论|参考|内容)|side (?:topics?|discussions?)(?: and references)?)$/iu.test(section.title.trim())
 ));
}
