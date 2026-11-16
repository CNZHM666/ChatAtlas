import type {WikiKnowledgeLedger,WikiKnowledgeUnit} from "../shared/wiki-knowledge";

const quoted=(text:string)=>[...text.matchAll(/[“「]([^”」]{3,44})[”」]/gu)].map(match=>match[1]);
const normalized=(text:string)=>text.replace(/[\s*_`]/gu,"").toLowerCase();
export const wikiUnconfirmedWorkflowFeedback=(text:string)=>/^在「[^」]+」的独立入口中，讨论中的成功反馈建议[：:]/u.test(text);

/** Resolve the selected route and a separately confirmed, named entry point.
 * Sharing an action or confirmation trigger does not merge the two flows. */
export function wikiWorkflowScopes(ledger:WikiKnowledgeLedger,units:ReadonlyMap<string,WikiKnowledgeUnit>){
 const prefixes=new Map<string,{entry:string;route:boolean}>();
 const narrowed=new Map<string,{statement:string;anchor:WikiKnowledgeUnit;feedbackIds:string[]}>();
 const answers=(ledger.userAnswers??[]).flatMap(answer=>{
  const question=ledger.writingQuestions?.find(item=>item.id===answer.questionId);
  const option=question?.options.find(item=>item.id===answer.optionId);
  if(!question||!option)return [];
  const covered=[...new Set(option.actions.flatMap(action=>action.do==="confirm"?action.units:[]))].flatMap(id=>units.get(id)??[]);
  const confirmed=covered.filter(unit=>ledger.decisions?.[unit.id]?.verdict==="confirmed");
  return covered.length?[{question,answer,confirmed,covered}]:[];
 });
 for(const {question,confirmed} of answers){
  const choice=question.ask.match(/确认[^？?\n]{1,38}?后[，,]\s*(?:是)?([^？?\n]+?)\s*(?:，\s*)?还是([^？?\n]+)/u);
  const destination=choice?.[1].match(/(?:自动)?返回\s*(?:当前)?\s*([^，,。；]{2,35}?)(?=\s*并|\s*后)/u)?.[1]?.trim();
  const alternative=choice&&quoted(choice[2]);
  if(!destination||!alternative?.length)continue;
  const selected=confirmed.filter(unit=>normalized(unit.statement).includes(normalized(destination))&&/返回/u.test(unit.statement));
  if(!selected.length)continue;
  for(const sibling of answers){
   if(sibling.question.id===question.id)continue;
   const scope=sibling.question.ask.match(/^关于[“「]([^”」]{2,28})[”」]([^。！？?]{5,105}?)的方案[，,](?:是否|是否已)[^。！？?]+[？?]$/u);
   if(!scope||!/^(?:确认(?:实施|采用)?|同意|是)[。！!]?$/u.test(sibling.answer.answer.trim()))continue;
   const [,entry,subject]=scope;
   const anchor=entry&&sibling.covered.find(unit=>quoted(unit.statement).includes(entry)&&/负责|入口|页面/u.test(unit.statement));
   if(!entry||!anchor)continue;
   const tokens=quoted(anchor.statement).filter(value=>value!==entry).map(value=>value.replace(/^[^\p{L}\p{N}]+/u,""));
   const scoped=sibling.covered.filter(unit=>unit!==anchor&&!selected.includes(unit)&&
    [...alternative,...tokens].some(label=>label.length>=3&&unit.statement.includes(label))&&/确认|成功|结果/u.test(unit.statement));
   if(!scoped.length)continue;
   const modes=subject.match(/[A-Za-z][\w/-]{2,}/gu)??[];
   if(!modes.length||!modes.every(mode=>normalized(anchor.statement).includes(mode.toLowerCase())))continue;
   narrowed.set(sibling.question.id,{statement:`「${entry}」${subject.trim()}。`,anchor,feedbackIds:scoped.map(unit=>unit.id)});
   for(const unit of scoped)prefixes.set(unit.id,{entry,route:false});
   for(const unit of selected)prefixes.set(unit.id,{entry:destination,route:true});
  }
 }
 const qualify=(text:string,ids:readonly string[])=>{
  if(ids.length!==1||!/^(?:用户确认|项目发起人确认|确认(?:成功|后|结果)|识别确认)/u.test(text))return text;
  const scope=prefixes.get(ids[0]);
  if(!scope||text.startsWith(`在「${scope.entry}」`))return text;
  return scope.route?`在「${scope.entry}」的识别流程中，${text}`:`在「${scope.entry}」的独立入口中，讨论中的成功反馈建议：${text}`;
 };
 return {qualify,narrowed};
}
