/** Local CSV analysis shared by the developer panel and offline CLI. No model calls. */
export function parseAnalysisCsv(text) {
 const rows=[];let row=[],cell="",quoted=false;
 text=text.replace(/^\uFEFF/u,"");
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||!cell)quoted=!quoted;else throw new Error("Invalid CSV quote");}
  else if(!quoted&&(ch===","||ch==="\n"||ch==="\r")){row.push(cell);cell="";if(ch!==","){if(row.some(Boolean))rows.push(row);row=[];if(ch==="\r"&&text[i+1]==="\n")i++;}}
  else cell+=ch;
 }
 if(quoted)throw new Error("Unclosed CSV quote");
 if(cell||row.length){row.push(cell);if(row.some(Boolean))rows.push(row);}
 const headers=rows.shift()??[];
 if(new Set(headers).size!==headers.length||!["requests","input_tokens","output_tokens","failed_requests"].every(key=>headers.includes(key)))throw new Error("Not an organization analysis CSV");
 return rows.map(values=>{if(values.length!==headers.length)throw new Error("CSV column count mismatch");return Object.fromEntries(headers.map((key,index)=>[key,values[index]]));});
}
export function summarizeAnalysisCsv(text) {
 const rows=parseAnalysisCsv(text);
 const number=(value)=>{if(value===undefined||value==="")return undefined;const n=Number(value.replace(/^'(?=[+-])/u,""));if(!Number.isFinite(n)||n<0)throw new Error("Invalid numeric metric");return n;};
 const sum=(key)=>{const values=rows.map(row=>number(row[key]));return values.length&&values.every(n=>n!==undefined)?values.reduce((a,b)=>a+b,0):undefined;};
 const stages=Object.create(null),origins={local:0,model:0,provider:0,network:0,unknown:0};
 let originsMeasured=0;
 for(const row of rows){
  if(row.request_stage_metrics){const metrics=JSON.parse(row.request_stage_metrics);if(!Array.isArray(metrics))throw new Error("Invalid stage metrics");for(const metric of metrics){if(typeof metric.stage!=="string")throw new Error("Invalid stage");stages[metric.stage]=(stages[metric.stage]??0)+(number(String(metric.requests))??0);}}
  if(row.failures_by_origin){const counts=JSON.parse(row.failures_by_origin);if(!counts||Array.isArray(counts)||typeof counts!=="object")throw new Error("Invalid failure counts");for(const key of Object.keys(origins))origins[key]+=number(String(counts[key]??0))??0;originsMeasured++;}
  else origins.unknown+=number(row.failed_requests)??0;
 }
 const readable=rows.flatMap(row=>{const n=number(row.first_readable_ms);return n===undefined?[]:[n];}).sort((a,b)=>a-b);
 const median=readable.length?(readable[Math.floor((readable.length-1)/2)]+readable[Math.ceil((readable.length-1)/2)])/2:undefined;
 return {runs:rows.length,requests:sum("requests"),inputTokens:sum("input_tokens"),outputTokens:sum("output_tokens"),cachedInputTokens:sum("cached_input_tokens"),failures:sum("failed_requests"),failuresByOrigin:origins,originsMeasured,stages,firstReadableMs:median,firstReadableMeasured:readable.length,elapsedMs:sum("elapsed_ms"),statuses:rows.reduce((counts,row)=>{counts[row.status??"unknown"]=(counts[row.status??"unknown"]??0)+1;return counts;},{})};
}
export function compareBenchmarks(before,after) {
 const metrics=["runs","requests","inputTokens","outputTokens","cachedInputTokens","failures","firstReadableMs","elapsedMs"];
 const values=metrics.map(metric=>({metric,before:before[metric],after:after[metric]}));
 for(const stage of new Set([...Object.keys(before.stages),...Object.keys(after.stages)]))values.push({metric:`stage:${stage}`,before:before.stages[stage],after:after.stages[stage]});
 for(const origin of Object.keys(before.failuresByOrigin))values.push({metric:`failure:${origin}`,before:before.failuresByOrigin[origin],after:after.failuresByOrigin[origin]});
 return values.map(row=>({...row,delta:row.before===undefined||row.after===undefined?undefined:row.after-row.before,percent:row.before&&row.after!==undefined?(row.after-row.before)/row.before*100:undefined}));
}
