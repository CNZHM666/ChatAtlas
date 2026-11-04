import { isHistoryLookup } from "../ai/home-task";
export type HomeEntryIntent="find"|"project"|"summarize"|"review"|"continue"|"choose";
/** Literal action routing only. Ambiguous prose is left for an explicit user choice. */
export function homeEntryIntent(input:string):HomeEntryIntent {
  const text=input.trim().replace(/^(?:请(?:帮我)?|帮我|我想|想要|麻烦)(?:一下)?\s*/u,"");
  if(!text)return "find";
  if(/^(?:继续|推进|恢复|continue\b|resume\b).*(?:项目|上次|project|last)/iu.test(text))return "continue";
  if(/^(?:总结|汇总|summari[sz]e\b)/iu.test(text))return "summarize";
  if(/^(?:复习|review\b|revise\b)/iu.test(text))return "review";
  if(/^(?:整理|创建|新建|建立|organize\b|create\b|build\b)|^把.*整理.*项目/iu.test(text))return "project";
  if(isHistoryLookup(text)||/在哪里|哪条|哪段|之前.*讨论|where\b.*(?:discuss|conversation)/iu.test(text))return "find";
  return "choose";
}
