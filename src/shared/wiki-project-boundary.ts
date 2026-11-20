import type {FocusSession} from "./focus-session";
import {projectIntroduction} from "./project-knowledge-view";
import {aboutNameKey} from "./wiki-knowledge";

/** Saved project identity is context, never new source proof or a chapter list. */
export interface WikiProjectBoundary { name:string; purpose?:string }
/** Only the project name and a description the user wrote. An introduction
 * derived from the Wiki's own conclusions adds no new identity, and it changes
 * with every organizing run, which would invalidate every planning and writing
 * cache keyed on this boundary. */
export function savedWikiProjectBoundary(session:FocusSession):WikiProjectBoundary {
 const introduction=projectIntroduction(session);
 const text=introduction.source==="personal"?introduction.text.trim():"";
 return {name:session.title.trim(),...(text&&text.length<=1200?{purpose:text}:{})};
}

export function wikiProjectTitleSuggestion(session: FocusSession, title = session.title): string | undefined {
  const suggested = session.wikiSuggestedTitle?.trim();
  if (suggested && suggested !== title && session.wikiKnowledge?.scopeAnswers?.[aboutNameKey(suggested)] !== "exclude") return suggested;
}
