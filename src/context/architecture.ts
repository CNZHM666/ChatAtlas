import type {ConversationMessage} from "../shared/types";
import type {ProjectModule,ProjectState} from "../shared/project-state";
import {sourceMessageSignature} from "../shared/source-signature";
import {referenceEvidence} from "../shared/statement-evidence";

/** Narrow fallback for explicit original module lists and arrows. It never
 * infers relationships from co-occurrence or treats examples as implementation. */
export function originalArchitecture(messages:ConversationMessage[]){
 const modules:ProjectModule[]=[],relations:ProjectState["relations"]=[],evidence:Array<{id:string;conversationId:string;messageId:string;title:string;excerpt:string;sourceSignature:string}>=[];
 for(const message of messages){
  const id=`architecture-original:${JSON.stringify([message.conversationId,message.id])}`,found:ProjectModule[]=[];
  let architectural=false,fence="";const arrows:string[]=[];
  for(const line of message.content.split("\n")){
   const delimiter=line.trimStart().match(/^(`{3,}|~{3,})/u)?.[1];if(delimiter){if(!fence)fence=delimiter;else if(delimiter[0]===fence[0]&&delimiter.length>=fence.length)fence="";continue;}if(fence)continue;
   if(/^(?: {4}|\t)/u.test(line))continue;
   if(/(?:→|->)/u.test(line))arrows.push(line);
   if(/^#{1,6}\s/u.test(line))architectural=/模块|架构|核心(?:能力|功能)|module|architecture|core (?:capabilit|feature)/iu.test(line);
   const match=line.match(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)\*\*([^*\n]{2,70})\*\*\s*[:：]\s*(\S.{2,450})$/u);
   if(!match||!architectural&&!/模块|服务|引擎|适配器|\b(?:module|service|engine|adapter)\b/iu.test(match[1]))continue;
   if(!found.length)evidence.push({id,conversationId:message.conversationId,messageId:message.id,title:"",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)});
   found.push({id:`${id}:${found.length}`,title:match[1],purpose:match[2],layer:"",inputs:[],outputs:[],status:message.role==="assistant"||referenceEvidence(message.content,line.trim())?"proposal":"documented",quote:line.trim(),evidenceIds:[id]});
  }
  for(const line of arrows)for(const from of found)for(const to of found){
   if(from===to)continue;
   const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&");
   const flow=line.trim().replace(/^(?:数据流|流程|flow)\s*[:：]\s*/iu,"");
   if(new RegExp(`^${escape(from.title)}\\s*(?:→|->)\\s*${escape(to.title)}[。.]?$`,"u").test(flow))relations.push({from:from.id,to:to.id,label:line.trim(),kind:"flow",quote:line.trim(),evidenceIds:[id]});
  }
  modules.push(...found);
 }
 return {modules,relations,evidence};
}
