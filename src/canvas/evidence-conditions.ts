/** Numeric conditions are anchors, not ordinary similarity words. Keep units
 * and inclusive/exclusive bounds so "10 人以上" cannot match "20 人以下". */
export interface EvidenceCondition {
  value: number;
  end?: number;
  unit: string;
  bound: "exact" | "min" | "max" | "gt" | "lt" | "range" | "approx";
}

const number = "(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万]+)";
const pattern = new RegExp(`(?<![A-Za-z0-9_.几数])(?<before>不少于|不低于|不超过|不多于|不高于|至少|至多|最多|超过|大于|多于|少于|小于|低于|大约|大概|约|>=|<=|≥|≤|>|<)?\\s*(?<value>${number})(?:\\s*(?:[~～–—-]|至|到)\\s*(?<end>${number}))?\\s*(?:个|名|位)?\\s*(?<unit>用户|人|毫秒|分钟|小时|星期|个月|天|日|周|月|年|秒|分钟|条|个|篇|章|次|%)(?<after>\\s*(?:以上|以下|以内|之内|以外))?`, "gu");
const plain = (text:string) => text.normalize("NFKC").replace(/[*`_]/gu, "");

function numeric(value:string):number {
  if(/^\d/u.test(value))return Number(value);
  const digits:Record<string,number>={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  const multipliers:Record<string,number>={十:10,百:100,千:1000};
  let total=0,section=0,last=0;
  for(const char of value){
    if(char in digits){last=digits[char];continue;}
    if(char==="万"){total+=(section+last||1)*10000;section=0;last=0;continue;}
    section+=(last||1)*(multipliers[char]??1);last=0;
  }
  return total+section+last;
}

export function evidenceConditions(text:string):EvidenceCondition[] {
  return [...plain(text).matchAll(pattern)].filter(match=>{
    const {value,unit,before,after,end}=match.groups!;
    // "一个聊天机器人" is commonly an indefinite article, not a count limit.
    return !(value==="一"&&unit==="个"&&!before&&!after&&!end);
  }).map(match=>{
    const {value,end,unit,before="",after=""}=match.groups!;
    const qualifier=before||after.trim();
    const bound:EvidenceCondition["bound"]=end?"range":/^(?:不少于|不低于|至少|>=|≥|以上)$/u.test(qualifier)?"min":/^(?:不超过|不多于|不高于|至多|最多|<=|≤|以下|以内|之内)$/u.test(qualifier)?"max":/^(?:超过|大于|多于|>|以外)$/u.test(qualifier)?"gt":/^(?:少于|小于|低于|<)$/u.test(qualifier)?"lt":/^(?:约|大约|大概)$/u.test(qualifier)?"approx":"exact";
    return {value:numeric(value),...(end?{end:numeric(end)}:{}),unit:/^(?:人|用户)$/u.test(unit)?"person":unit==="日"?"天":unit==="星期"?"周":unit==="个月"?"月":unit,bound};
  });
}

export function evidenceConditionsMatch(required:EvidenceCondition[],text:string):boolean {
  if(!required.length)return true;
  const found=evidenceConditions(text);
  return required.every(own=>found.some(other=>own.value===other.value&&own.end===other.end&&own.unit===other.unit&&own.bound===other.bound));
}

/** The predicate of a condition, with numeric labels removed. It must also
 * match: finding just "10 人以上" is not evidence for an unrelated action. */
export function evidenceConditionDescription(text:string):string {
  return plain(text).replace(pattern," ").replace(/(?:^|\s)(?:如果|若|当|假如|假设)(?=\s|$)/gu," ").trim();
}

export function evidenceConditionDescriptionMatches(description:Set<string>,passage:Set<string>):boolean {
  let shared=0;for(const term of description)if(passage.has(term))shared++;
  return shared>=Math.min(3,Math.ceil(description.size*.4));
}

/** Only a short, unfinished condition can pull in adjacent prose. Complete
 * sentences and a following branch are boundaries, not matching windows. */
export function evidenceConditionLabel(text:string):boolean {
  const value=plain(text).trim();
  return value.length<=90&&evidenceConditions(value).length>0&&!/[。！？!?；;]/u.test(value)&&evidenceConditionDescription(value).replace(/[\s:：,，、()（）]/gu,"").length<=18;
}
