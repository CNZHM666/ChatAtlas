import type {WikiVerification} from "./wiki-explanations";

const sourceDate=(at:number|undefined,zh:boolean)=>at?new Date(at).toLocaleDateString(zh?"zh-CN":"en"):"";
/** What kind of document this is, from saved checks rather than model claims.
 * One text for the reader overview and every export. */
export function wikiDocumentIdentity(verification:WikiVerification,zh:boolean):string[]{
 const {sources,claims}=verification,range=sources.earliest&&sources.latest?`${sourceDate(sources.earliest,zh)} — ${sourceDate(sources.latest,zh)}`:"";
 const kind=verification.status==="decisions_checked"
  ?(zh?"文档类型：项目 Wiki（已按所选来源核对关键决定）。":"Document type: project Wiki (key decisions checked against the selected sources).")
  :(zh?`文档类型：历史讨论整理稿。内容已组织，但${claims.unread?`${claims.unread} 条关键结论尚未对照原文核对`:"仍有决定或变化关系未核对"}${verification.openIssues?`，另有 ${verification.openIssues} 处待处理的表述问题`:""}。`:`Document type: organized discussion record. Content is organized, but ${claims.unread?`${claims.unread} key conclusions are not yet read against originals`:"some decisions or changes are not yet checked"}${verification.openIssues?`; ${verification.openIssues} wording issues remain`:""}.`);
 const scope=zh?`来源范围：${sources.conversations} 个对话、${sources.messages} 条被引用消息${range?`，原始讨论时间 ${range}`:""}；用户确认的决定 ${claims.confirmed} 条，未确认建议 ${claims.proposals} 条。`:`Source scope: ${sources.conversations} conversations, ${sources.messages} cited messages${range?`, discussed ${range}`:""}; ${claims.confirmed} user-confirmed decisions, ${claims.proposals} unconfirmed proposals.`;
 const implementation=zh?"实现核对：未进行。正文中的“已完成”只代表用户报告，不代表代码已核验。":"Implementation check: not performed. \"Completed\" in the text means user-reported, not verified in code.";
 return [kind,scope,implementation];
}

/** The same record as two short items for a crowded facts line; the full
 * sentences above go in its tooltip. */
export function wikiDocumentIdentityBrief(verification:WikiVerification,zh:boolean):{period?:string;label:string}{
 const {earliest,latest}=verification.sources;
 const day=(at:number)=>{const date=new Date(at);return `${date.getMonth()+1}/${date.getDate()}`;};
 const period=earliest&&latest?earliest===latest?day(earliest):`${day(earliest)}–${day(latest)}`:undefined;
 const kind=verification.status==="decisions_checked"?(zh?"已核对关键决定":"Key decisions checked"):(zh?"整理稿":"Organized record");
 // Open wording issues are counted in the document notes; a count in the one-line header only asks "which ones?".
 return {...(period?{period}:{}),label:kind};
}
