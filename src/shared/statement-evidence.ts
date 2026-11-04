import { wikiQuoteRange } from "./wiki-claims";

/** Transport role is not authorship. Inspect the enclosing material, not just
 * the selected sentence; a pasted pack can contain first-person approvals too. */
export function referenceEvidence(content:string,quote:string):boolean {
 const range=wikiQuoteRange(content,quote);if(!range)return true;
 const before=content.slice(0,range.start),line=content.slice(before.lastIndexOf("\n")+1,range.end);
 if(/^\s*\\?>/u.test(line)||/^\s*(?:["'].*["']|“[^”]*”|「[^」]*」|『[^』]*』)\s*$/u.test(quote))return true;
 for(const [open,close] of [["“","”"],["「","」"],["『","』"],["\"","\""],["`","`"]]){
  const start=before.lastIndexOf(open),lastClose=before.lastIndexOf(close);
  if(start>=0&&(open===close?(before.slice(before.lastIndexOf("\n")+1).split(open).length-1)%2===1:start>lastClose)&&content.indexOf(close,range.end)>=range.end)return true;
 }
 const markers=[...before.matchAll(/(?:以下|下面|这是|附上|粘贴|转贴|引用|参考)[^\n。！？]{0,55}(?:上下文(?:包)?|材料|文档|总结|AI\s*(?:建议|回复|回答)|提示词)|(?:pasted|quoted|reference)\s+(?:context|material|document|summary|response)/giu)];
 const marker=markers.at(-1);
 if(marker){const tail=before.slice(marker.index!+marker[0].length);if(!/(?:以上(?:为|是|内容).*?(?:引用|材料|原文)|引用结束|我的(?:要求|决定|确认|请求)\s*[:：]|end of (?:quote|reference)|my (?:request|decision|confirmation)\s*:)/iu.test(tail))return true;}
 const sentenceStart=Math.max(before.lastIndexOf("\n"),before.lastIndexOf("。"),before.lastIndexOf("！"),before.lastIndexOf("？"))+1;
 return /(?:^|[\s：:。！？])(?:用户|使用者|项目方|(?:the )?user|the team)(?:已经|已|最终|正式|明确| has| have)*\s*(?:确认|决定|采纳|采用|认可|完成|实现|表示|提到|称|confirmed|approved|decided)/iu.test(content.slice(sentenceStart,range.end));
}

/** An execution request can approve a bounded antecedent, but is neither a
 * stand-alone design choice nor evidence that implementation has completed. */
export function implementationRequest(content:string,quote=content):boolean {
 if(referenceEvidence(content,quote)||/[？?]|(?:先|仅|只)(?:做)?分析|分析.{0,8}(?:方案|建议)|(?:先|暂时)?(?:不要|别|不必|不需要|不用).{0,12}(?:改|执行|实施|实现|开发)|如果|假设|提示词|文案|草图|示例|\b(?:if|prompt|example|do not|don't|only analy[sz]e)\b/iu.test(content))return false;
 return /^(?:(?:可以|好(?:的)?)[，,\s]*)?(?:(?:请|麻烦)?(?:帮我|给我)|请|直接|开始|现在|继续执行)(?:直接|现在|开始|进行|把|对|将|先)?[^。！？\n]{0,100}(?:执行|实施|实现|落实|落地|优化|修复|改进|修改|开发|做完)|^(?:please\s+)?(?:implement|execute|apply|go ahead with)\b/iu.test(quote.trim());
}

const approvalTerms=(text:string)=>{const clean=text.normalize("NFKC").toLowerCase().replace(/p(\d+)\s*[-–—]\s*p?(\d+)/giu,"p$1 p$2").replace(/确认|决定|采用|使用|建议|同意|这个|那个|方案|我们|现在|进行|需要|就按|可以|帮我|给我|优化|修复|改进|执行|实施|实现|直接|开始|请|了|吧|的|\b(?:confirm(?:ed)?|adopt|use|suggest|the|this|that|plan|approach|we|to|i|you|my|our|it|please|implement|execute|apply)\b/giu," ");const words=clean.match(/[a-z][a-z\d_+-]*|[\p{Script=Han}]+/gu)??[];return new Set(words.flatMap(word=>/\p{Script=Han}/u.test(word)?Array.from({length:Math.max(0,word.length-1)},(_,index)=>word.slice(index,index+2)):[word]));};

/** Conservative local rejection checks, not a semantic verifier. Always inspect
 * the surrounding original sentence: a clipped quote can hide a question,
 * negation, attribution or hypothetical. Unknown is never approval. */
export function statementEvidence(content:string,quote:string){
 const range=wikiQuoteRange(content,quote);if(!range)return {decision:false,explicitDecision:false,report:false,plan:false,suggestion:false,preference:false};
 const before=content.slice(0,range.start),after=content.slice(range.end);
 const start=Math.max(before.lastIndexOf("\n"),before.lastIndexOf("。"),before.lastIndexOf("！"),before.lastIndexOf("？"))+1;
 const tail=after.search(/[。！？!?\n]/u),endsSentence=/[。！？!?\n]$/u.test(content.slice(range.start,range.end));
 const sentence=content.slice(start,endsSentence?range.end:tail<0?content.length:range.end+tail+1).trim();
 const inCode=(before.match(/(?:^|\n)\s*```/gu)?.length??0)%2===1||(before.match(/(?:^|\n)\s*~~~/gu)?.length??0)%2===1;
 const question=/[？?]|是否|能否|要不要|有没有|为什么|怎么(?:样|做|办)|\b(?:should we|could we|did we|have we|why|whether)\b/iu.test(sentence);
 const attribution=/你(?:之前|曾经|刚才)?(?:说|建议|提到)|(?:AI|助手|模型)(?:曾经|之前)?(?:建议|说|提出)|\b(?:you (?:suggested|said|recommended)|the (?:ai|assistant) (?:suggested|said))\b/iu.test(sentence);
 const hypothetical=/如果|假如|例如|示例|假设|\b(?:if|example|hypothetical)\b/iu.test(sentence);
 const uncertainty=/尚未确认|还没决定|未决定|还没有(?:正式)?(?:定案|决定|确认)|尚未定案|未定案|不确定|可能|也许|\b(?:undecided|perhaps|might)\b/iu.test(sentence);
 const suggestion=/建议|不妨|可以考虑|\b(?:suggest|recommend|could|should consider)\b/iu.test(sentence);
 const plan=/计划|准备|下一步|接下来|尚未(?:完成|开发|实现|开始|发布)|还没(?:完成|开发|实现|开始|发布)|将(?:要|会)|\b(?:plan(?:ned)?|will|not yet (?:complete|implemented|released|started)|intend)\b/iu.test(sentence);
 const commitment=/(?:决定(?:采用|使用|改用|改为|保留|不再|取消)|(?:正式|最终)(?:确认|采用|决定)|确认采用|\b(?:i|we) (?:have )?decided\b)/iu.test(sentence);
 const reference=referenceEvidence(content,quote);
 const preference=!reference&&!commitment&&!inCode&&!question&&!attribution&&!hypothetical&&/(?:我|我们)?(?:更)?(?:喜欢|偏好|倾向|觉得.{0,12}(?:好看|舒服))|\b(?:i|we) (?:like|prefer|love)\b/iu.test(sentence);
 const artifact=/提示词|prompt|文案|示例|草图/iu.test(sentence)&&!/(?:决定|正式确认|采用.{0,30}(?:作为|用于))/u.test(sentence);
 const deictic=/^(?:就|可以)?(?:按|用|选|选择|采用)(?:第?[一二三123]|这|那)/u.test(sentence);
 const blocked=reference||inCode||question||attribution||hypothetical||uncertainty||preference||artifact||deictic;
 // A scoped completion followed by a different pending capability is a partial
 // work report. Keep the entire original, including its unfinished qualification.
 const partialReport=/^(?:我|我们)(?:已经|已)(?:完成|实现|发布|接入)[^，,；;。\n]+[，,；;]\s*[^，,；;。\n]+(?:尚未|还没)(?:完成|开发|实现|开始|发布)[。.!！]?$/u.test(sentence)
  &&!/(?:其实|实际|并未|并没有|没有完成|说错|不对)/u.test(sentence);
 return {
  reference,
  preference,
  explicitDecision:!blocked&&!suggestion&&/(?:我(?:们)?(?:已|已经)?(?:决定|确认)|(?:最终|正式)(?:采用|决定|确认)|决定(?:采用|改用|改为|保留|不再|取消)|确认(?:采用|使用|保留)|就按|\b(?:i|we) (?:have )?(?:decided|confirm)|\b(?:adopt|switch to)\b)/iu.test(sentence),
  decision:!blocked&&!suggestion&&/(?:确认|决定|采用|改用|改为|使用|不再|暂缓|重新启动|恢复(?:开发|实施)|沿用|不改|维持|先不做|暂不做|延期|推迟|取消|就按|保留|只(?:用|做)|\b(?:adopt|use|decided|confirmed|switch|keep)\b)/iu.test(sentence),
  report:!blocked&&!suggestion&&(partialReport||!plan&&!/(?:没有|尚未|未曾|没|不)(?:完成|实现|通过|发布|上线)|\b(?:not|never) (?:completed|implemented|released|finished)\b/iu.test(sentence)&&/(?:已(?:经)?(?:正式)?(?:完成|实现|通过|发布|上线|接入|做完)|完成了|实现了|发布了|上线了|正在(?:开发|实现|测试|处理)|\b(?:completed|implemented|finished|released|shipped|in progress)\b)/iu.test(sentence)),
  plan:!blocked&&!suggestion&&plan,
  suggestion:!inCode&&suggestion,
 };
}

/** Short assent needs one unambiguous adjacent proposal, not merely a later user role. */
export function confirmsProposal(approval:{content:string;conversationId?:string;messageIndex?:number;replyToMessageId?:string},quote:string,proposal:{content:string;conversationId?:string;messageIndex?:number;id?:string;role?:string;partial?:boolean},proposalQuote=proposal.content){
 const sameConversation=approval.conversationId===proposal.conversationId;
 const adjacent=sameConversation&&(Boolean(proposal.id&&approval.replyToMessageId===proposal.id)||approval.messageIndex!==undefined&&proposal.messageIndex!==undefined&&approval.messageIndex===proposal.messageIndex+1);
 const intent=statementEvidence(approval.content,quote);
 if(!sameConversation||intent.preference||intent.reference||!wikiQuoteRange(approval.content,quote))return false;
 // Resolve only explicit, bounded enumerations. A clipped proposal quote cannot hide alternatives.
 const explicitOptions=[...proposal.content.matchAll(/(?:^|\n)\s*(?:方案\s*[一二三123ABCabc]|(?:Option|Approach)\s*[123ABCabc])/giu)].length>1;
 const numbered=[...proposal.content.matchAll(/(?:^|\n)\s*[123ABCabc][.)、]/giu)].length>1;
 const sequence=/分步|步骤|实施|执行计划|优化方案|优化计划|修复计划|\b(?:implementation plan|steps)\b/iu.test(proposal.content);
 const enumerated=explicitOptions||numbered&&(!sequence||/二选一|备选|可选方案|以下.{0,8}(?:方案|选项)|(?:选择|选一个|choose|alternatives|options)\s*[:：]/iu.test(proposal.content));
 const ordinal=approval.content.trim().match(/^(?:就|可以)?(?:按|用|选|选择|采用)(?:第)?([一二三123ABCabc])(?:种|个|项|套|方案)?[。.!！\s]*$/u);
 if(ordinal){
  if(!adjacent)return false;
  const numbers:Record<string,number>={一:1,二:2,三:3,A:1,B:2,C:3,a:1,b:2,c:3};
  const index=numbers[ordinal[1]]??Number(ordinal[1]);
  const options=[...proposal.content.matchAll(/(?:^|\n)\s*(?:方案\s*([一二三123ABCabc])|(?:Option|Approach)\s*([123ABCabc])|([123ABCabc])[.)、])\s*[：:]?\s*/giu)];
  if(options.length<2||new Set(options.map(item=>(item[1]??item[2]??item[3]).toUpperCase())).size!==options.length)return false;
  const at=options.findIndex(item=>(numbers[item[1]??item[2]??item[3]]??Number(item[1]??item[2]??item[3]))===index);
  if(at<0)return false;
  const selected=proposal.content.slice(options[at].index!+options[at][0].length,options[at+1]?.index??proposal.content.length).trim();
  const range=wikiQuoteRange(selected,proposalQuote);
  return Boolean(range)&&!statementEvidence(selected,proposalQuote).preference;
 }
 if(implementationRequest(approval.content,quote)){
  if(!adjacent||proposal.role!=="assistant"||proposal.partial||enumerated||!wikiQuoteRange(proposal.content,proposalQuote)||!/建议|方案|计划|优化|实施|修复|实现|\b(?:plan|propos|implement|fix)/iu.test(proposal.content))return false;
  const phases=(text:string)=>new Set(text.normalize("NFKC").replace(/p(\d+)\s*[-–—]\s*p?(\d+)/giu,"p$1 p$2").toLowerCase().match(/\bp\d+\b/gu)??[]);
  const selected=phases(quote),offered=phases(proposalQuote),all=phases(proposal.content);
  if(selected.size){const scopes=offered.size?offered:all,named=approvalTerms(quote.replace(/p\d+(?:\s*[-–—]\s*p?\d+)?/giu,""));const context=approvalTerms(proposal.content);return scopes.size>0&&[...scopes].every(phase=>selected.has(phase))&&(!named.size||[...named].filter(term=>context.has(term)).length/named.size>=.6);}
  const named=approvalTerms(quote),target=approvalTerms(proposalQuote);
  return !named.size||[...named].filter(term=>target.has(term)).length/named.size>=.6;
 }
 if(statementEvidence(approval.content,quote).decision){
  const named=approvalTerms(quote),offered=approvalTerms(proposalQuote);
  // Named approval must concern the proposal it is attached to. A deictic
  // "use this approach" still needs the single adjacent proposal below.
  if(named.size&&[...named].filter(term=>offered.has(term)).length/named.size>=.6)return true;
  if(named.size)return false;
  return adjacent&&!enumerated&&!/(?:还是|或者|\bor\b|option\s*[AB12])/iu.test(proposal.content);
 }
 const assent=approval.content.trim();
 return /^(?:可以|好(?:的)?|同意|就这样|按这个来|yes|ok(?:ay)?|agreed)[，,。.!！\s]*(?:(?:帮我|请)?(?:实现|执行|继续)(?:吧|了)?[。.!！]?)?$/iu.test(assent)
  && wikiQuoteRange(approval.content,quote)!==undefined && adjacent
  && !enumerated && !/(?:还是|或者|二选一|方案\s*[AB]|\bor\b|option\s*[AB12])/iu.test(proposal.content)
  && statementEvidence(proposal.content,proposal.content).suggestion;
}
