const KEY="atlas-ui-failures-v1",LIMIT=20;
type Failure={at:number;scope:string;kind:"resource"|"render";name:string;frames:string[]};
/** Local bounded diagnostics. Never persist error messages, document text, URLs,
 * credentials or project identities. Only bundled asset frames are retained. */
export function recordUiFailure(error:unknown,scope:string){
 const value=error instanceof Error?error:new Error(String(error));
 const frames=(value.stack??"").split("\n").slice(1).flatMap(line=>line.match(/[\w.-]+\.(?:js|tsx?|jsx):\d+(?::\d+)?/gu)??[]).slice(0,8);
 const kind=/dynamically imported module|Loading (?:CSS )?chunk|Importing a module script failed|Unable to preload CSS/iu.test(value.message)?"resource" as const:"render" as const;
 const entry:Failure={at:Date.now(),scope,kind,name:/^(?:TypeError|ReferenceError|RangeError|SyntaxError|Error)$/u.test(value.name)?value.name:"Error",frames};
 try{const rows=readUiFailures();rows.push(entry);sessionStorage.setItem(KEY,JSON.stringify(rows.slice(-LIMIT)));}catch{/* Diagnostics must never break recovery. */}
 return entry;
}
export function readUiFailures():Failure[]{
 try{const rows:unknown=JSON.parse(sessionStorage.getItem(KEY)??"[]");return Array.isArray(rows)?rows.slice(-LIMIT).filter(row=>row&&typeof row.at==="number"&&typeof row.scope==="string"&&Array.isArray(row.frames)):[];}catch{return [];}
}
export function downloadUiFailures(){
 const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,failures:readUiFailures()},null,2)],{type:"application/json"}));
 const anchor=document.createElement("a");anchor.href=url;anchor.download="chatatlas-ui-diagnostics.json";anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function installUiFailureCapture(){
 const error=(event:ErrorEvent)=>recordUiFailure(event.error??new Error(event.message),"window");
 const rejection=(event:PromiseRejectionEvent)=>recordUiFailure(event.reason,"promise");
 window.addEventListener("error",error);window.addEventListener("unhandledrejection",rejection);
 return()=>{window.removeEventListener("error",error);window.removeEventListener("unhandledrejection",rejection);};
}
