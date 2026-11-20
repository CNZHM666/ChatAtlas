import {wikiDocumentBlocks} from "./wiki-document-blocks";
import {wikiSupplementRanges} from "./wiki-source-supplements";

export const RECOGNITION_TOPIC = /视觉识别|拍照识别|图像识别|图像导入|Visual Inventory|(?:photo|image) recognition/iu;
export const WORKSPACE_PANEL = /^(?:\*\*)?(?:工作区界面|工作区底部|底部面板|界面底部|(?:The )?(?:workspace|bottom panel))[^。\n]{0,100}(?:Bottom Panel|底部|Drawer|tabs?|面板)/iu;
export const SIMULATION_UI = /^(?:\*\*)?(?:仿真界面|仿真面板|simulation (?:interface|panel))/iu;
const SUPPORTING = /^(?:文案与错误处理|遇到\s+[A-Z_]{5,}|错误码|(?:error handling|error codes?))/iu;
const IMPLEMENTATION = /识别范围|识别流程|照片\s*(?:->|→)|视觉模型|confidence\s*数值|(?:视觉|Vision)\s*链|确认成功后|(?:photo|image) recognition (?:scope|flow)/iu;
const ENTRY = /(?:识别|上传|拍照).{0,16}(?:范围|入口)|第一版只识别|拍一下看看|拍照.{0,12}(?:按钮|入口)|识别流程|照片\s*(?:->|→)|(?:entry point|recognition scope)/iu;
const FINAL = /确认成功后|确认后.{0,24}(?:写入|加入|进入|引导)|(?:after confirmation|after the user confirms)/iu;
const CANDIDATE = /候选|用户确认|Catalog Match|置信度|confidence|candidate|user confirmations?/iu;
const FAILURE = /失败|不确定|未识别|错误码|重拍|低置信度|retry|failure|uncertain|errors?/iu;

export function recognitionImplementation(text:string) {
 return IMPLEMENTATION.test(text) || SUPPORTING.test(text) && /识别|视觉相关错误|\bVISION_[A-Z_]+|\brecognition\b/iu.test(text);
}

/** Reorder adjacent generated explanations within one named feature. Keep
 * authored lists, tables, citations and the order of actual procedure steps. */
export function orderWikiFeatureReading(body:string) {
 if(!RECOGNITION_TOPIC.test(body))return body;
 const attachments=wikiSupplementRanges(body);
 const blocks=wikiDocumentBlocks(body);
 const edits:Array<{start:number;end:number;text:string}>=[];
 let depth=0, run:typeof blocks=[];
 const rank=(text:string)=>ENTRY.test(text)?0:FINAL.test(text)?3:FAILURE.test(text)?2:CANDIDATE.test(text)?1:-1;
 const flush=()=>{
  const ordered=[...run].sort((a,b)=>rank(a.text)-rank(b.text));
  if(run.length>1&&ordered.some((item,index)=>item!==run[index]))edits.push({
   start:run[0].start,end:run.at(-1)!.end,text:ordered.map(block=>block.text).join("\n\n"),
  });
  run=[];
 };
 for(const block of blocks){
  if(attachments.some(([start,end])=>block.start>=start&&block.end<=end)){flush();continue;}
  if(block.kind==="heading"){
   flush();
   const level=block.text.match(/^#+/u)?.[0].length??0;
   if(RECOGNITION_TOPIC.test(block.text))depth=level;
   else if(depth&&level<=depth)depth=0;
  }else if(depth&&block.kind==="paragraph"&&rank(block.text)>=0&&!WORKSPACE_PANEL.test(block.text)&&!SIMULATION_UI.test(block.text))run.push(block);
  else flush();
 }
 flush();
 for(const {start,end,text} of edits.reverse())body=body.slice(0,start)+text+body.slice(end);
 return body;
}
