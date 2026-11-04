import type {DirectoryPage} from "../shared/wiki-directory";
import {documentNamedWikiTitle,genericWikiTitle} from "./wiki-outline-policy";
import {pairedWikiTitle,vagueWikiTitle} from "./wiki-title-pass";

export type BroadRefinement={pages:DirectoryPage[];reason:"broad_split"|"broad_renamed"}|{pages?:undefined;reason:"broad_kept"|"broad_unclear_title"|"broad_thin_split"|"broad_no_room"};

/** Whether a focused re-plan of one catch-all chapter replaces it. A split needs
 * clear single-subject titles, two subtopics per chapter and room under the
 * ceiling; one returned chapter is a rename, kept when its title is concrete,
 * since the document's own name says nothing about which subject it holds. */
export function broadRefinement(result:DirectoryPage[]|undefined,names:Array<string|undefined>,room:number):BroadRefinement {
 if(!result?.length)return {reason:"broad_kept"};
 if(result.some(page=>pairedWikiTitle(page.title)||vagueWikiTitle(page.title)||genericWikiTitle(page.title)||documentNamedWikiTitle(page.title,names)))return {reason:"broad_unclear_title"};
 if(result.length===1)return {pages:result,reason:"broad_renamed"};
 if(result.some(page=>(page.subtopics?.length??0)<2))return {reason:"broad_thin_split"};
 if(room<result.length-1)return {reason:"broad_no_room"};
 return {pages:result,reason:"broad_split"};
}
