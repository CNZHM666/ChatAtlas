import {decodeFocusWireOutput, focusOutputLanguagePaths} from "../shared/atlas/tasks.js";
import {AIProviderValidationError} from "./provider-errors";

type Field = {path:string;text:string};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const parts=(path:string)=>path.replace(/\[(\d+)\]/gu,".$1").split(".");
function read(root:unknown,path:string):unknown { let value=root;for(const key of parts(path)){if(!value||typeof value!=="object")return undefined;value=(value as Record<string,unknown>)[key];}return value; }
const literals=(text:string)=>text.match(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`|^\s*>.*$|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|https?:\/\/\S+|"[^"\n]*"|“[^”\n]*”/gmu)??[];
const identifiers=(text:string)=>(text.match(/\b(?:[A-Z]{2,}[A-Za-z0-9_]*|[A-Za-z]+[A-Z][A-Za-z0-9_]+)\b|\d+(?:\.\d+)*/gu)??[]).sort();

/** Keep the complete response locally; send only invalid generated fields. */
export function focusLanguageRepairFields(value:unknown,data:Record<string,unknown>):Field[] {
 const decoded=decodeFocusWireOutput(value,data);
 if(decoded.issue!=="wrong_output_language")return [];
 const root=object(value)&&object(value.result)?value.result:value;
 if(!object(root))return [];
 const prefix=root===value?"":"result.";
 const fields=focusOutputLanguagePaths(decoded.value,data).flatMap(path=>{
  let actual=path;
  const match=path.match(/^sections\[(\d+)\]\.(title|body|transition)$/u);
  if(match){
   const index=Number(match[1]),field=match[2],notes=Array.isArray(root.notes);
   const rows=notes?root.notes:root.sections;
   const row=Array.isArray(rows)?rows[index]:undefined;
   if(!object(row))return [];
   const aliases=field==="title"?["title","heading"]:field==="body"?notes?["text","body","content"]:["body","content"]:["transition"];
   const key=aliases.find(key=>typeof row[key]==="string");if(!key)return [];
   actual=`${notes?"notes":"sections"}[${index}].${key}`;
  }
  const text=read(root,actual);return typeof text==="string"?[{path:prefix+actual,text}]:[];
 });
 // Never silently repair a subset or resend a huge response as a fallback.
 return fields.length===focusOutputLanguagePaths(decoded.value,data).length&&fields.length<=24&&fields.reduce((sum,field)=>sum+field.text.length,0)<=24000?fields:[];
}

export function applyFocusLanguageRepair(original:unknown,fields:Field[],patch:unknown):unknown {
 const fail=()=>{throw new AIProviderValidationError("language_repair_invalid");};
 if(!object(patch)||Object.keys(patch).some(key=>key!=="translations")||!Array.isArray(patch.translations)||patch.translations.length!==fields.length) return fail();
 const expected=new Map(fields.map(field=>[field.path,field.text])),seen=new Set<string>();
 const output=structuredClone(original);
 for(const item of patch.translations){
  if(!object(item)||Object.keys(item).some(key=>!["path","text"].includes(key))||typeof item.path!=="string"||typeof item.text!=="string"||!item.text.trim()||!expected.has(item.path)||seen.has(item.path))return fail();
  if(JSON.stringify(literals(expected.get(item.path)!))!==JSON.stringify(literals(item.text)))return fail();
  if(JSON.stringify(identifiers(expected.get(item.path)!))!==JSON.stringify(identifiers(item.text)))return fail();
  const keys=parts(item.path),last=keys.pop()!,parent=keys.reduce<unknown>((value,key)=>value&&typeof value==="object"?(value as Record<string,unknown>)[key]:undefined,output);
  if(!parent||typeof parent!=="object"||typeof (parent as Record<string,unknown>)[last]!=="string")return fail();
  (parent as Record<string,unknown>)[last]=item.text;seen.add(item.path);
 }
 return output;
}
