import type {FocusSession} from "./focus-session";

const titleKey=(session:FocusSession)=>session.title.normalize("NFKC").trim().toLocaleLowerCase();

/** Names for the versions of one project. A title shared by several versions gets
 * when the version was made and how many chapters it has; versions made in the
 * same minute are also numbered by age. A unique title stays as it is, unless
 * `always` asks for the time anyway (a version listed away from its siblings). */
export function projectVersionLabels(sessions:FocusSession[],zh:boolean,always=false):Map<string,string>{
 const time=(at:number)=>new Date(at).toLocaleString(zh?"zh-CN":"en-GB",{month:zh?"numeric":"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false});
 const labels=new Map<string,string>();
 for(const session of sessions){
  const same=sessions.filter(other=>titleKey(other)===titleKey(session));
  const preview=session.status==="preview"?zh?" · 待确认":" · Preview":"";
  if(same.length<2&&!always){labels.set(session.id,session.title+preview);continue;}
  const made=time(session.createdAt);
  const sameMinute=same.filter(other=>time(other.createdAt)===made).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  const order=sameMinute.length>1?zh?` · 第 ${sameMinute.indexOf(session)+1} 版`:` · v${sameMinute.indexOf(session)+1}`:"";
  const chapters=session.sections.length?zh?` · ${session.sections.length} 章`:` · ${session.sections.length} chapters`:"";
  labels.set(session.id,`${session.title} · ${made}${chapters}${order}${preview}`);
 }
 return labels;
}
