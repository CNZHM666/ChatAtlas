import {sourceMessageSignature} from "./source-signature";
import type {FocusSession} from "./focus-session";
import {withoutProgressDisclaimer} from "./wiki-cross-duplicates";

/** Changes whenever any chapter's title, opening or body changes. */
export function wikiOverviewSignature(session:Pick<FocusSession,"sections">):string {
 return sourceMessageSignature(JSON.stringify(session.sections.map(section=>[section.id,section.title,section.body])));
}

/** Navigation-only fallback: no chapter prose, invented facts or model request.
 * Personal overviews are protected by the caller. Titles retain reading order. */
export function wikiReadingRouteOverview(session:FocusSession){
 const titles=session.sections.map(section=>section.title.trim()).filter(Boolean);
 if(!titles.length)return undefined;
 const zh=session.locale!=="en",quote=(text:string)=>zh?`「${text}」`:`“${text}”`;
 const route=titles.slice(0,3).map(quote);
 const text=zh?`这份文档按主题整理${quote(session.title)}的已有讨论。可先读${route[0]}${route.length>1?`，再看${route.slice(1).join("、")}`:""}${titles.length>3?"，其余章节按需查阅":""}。`
  :`This document organizes the existing discussions about ${quote(session.title)} by subject. Start with ${route[0]}${route.length>1?`, then read ${route.slice(1).join(" and ")}`:""}${titles.length>3?"; consult the remaining chapters as needed":""}.`;
 return {version:1 as const,text,signature:wikiOverviewSignature(session),evidenceIds:[] as string[]};
}

/** The generated overview, only while it still describes the current chapters
 * and the user has not written their own. */
export function currentWikiOverview(session:FocusSession){
 const overview=session.wikiOverview;
 if(!overview||session.briefUserEdited||session.projectMaintenance?.overview!==undefined||overview.version!==1||typeof overview.text!=="string"||!overview.text.trim())return undefined;
 // Saved overviews may still claim "no user confirmation"; the status line says that precisely.
 return overview.signature===wikiOverviewSignature(session)?{...overview,text:withoutProgressDisclaimer(overview.text)}:undefined;
}
