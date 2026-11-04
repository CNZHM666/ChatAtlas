import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {ArrowUpRight,Download,FileArchive,Upload,X} from "lucide-react";
import {usePreferences} from "../preferences";
import "../file-import-guide.css";

const officialGuide="https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data";
type GuidePlatform="chatgpt"|"claude"|"gemini"|"deepseek"|"other";
const GUIDE_PLATFORMS:Array<{id:GuidePlatform;zh:string;en:string}>=[{id:"chatgpt",zh:"ChatGPT",en:"ChatGPT"},{id:"claude",zh:"Claude",en:"Claude"},{id:"gemini",zh:"Gemini",en:"Gemini"},{id:"deepseek",zh:"DeepSeek",en:"DeepSeek"},{id:"other",zh:"其他 AI",en:"Other AI"}];

/** Shared by file-import entries. Opening or reading the guide never imports,
 * requests an export, or calls a model. The user explicitly chooses a file. */
export function ChatGPTFileImport({onImport,disabled=false,children,className,ariaLabel}:{
 onImport:(file:File)=>void;disabled?:boolean;children:ReactNode;className?:string;ariaLabel?:string;
}){
 const {locale}=usePreferences(),zh=locale==="zh-CN";
 const [open,setOpen]=useState(false),input=useRef<HTMLInputElement>(null);
 return <>
  <button type="button" className={className} disabled={disabled} aria-label={ariaLabel} aria-haspopup="dialog" onClick={()=>setOpen(true)}>{children}</button>
  <input ref={input} type="file" aria-label={zh?"导入对话文件":"Import conversation file"} accept=".zip,.json,.md,.markdown,.txt,application/zip,application/json,text/markdown,text/plain" hidden disabled={disabled} onChange={event=>{
   const field=event.currentTarget,file=field.files?.[0];
   try{if(file&&!disabled){setOpen(false);onImport(file);}}finally{field.value="";}
  }}/>
  {open?<ChatGPTExportGuide zh={zh} disabled={disabled} onClose={()=>setOpen(false)} onChoose={()=>input.current?.click()}/>:null}
 </>;
}

function ChatGPTExportGuide({zh,disabled,onClose,onChoose}:{zh:boolean;disabled:boolean;onClose:()=>void;onChoose:()=>void}){
 const titleId=useId(),panel=useRef<HTMLDivElement>(null),body=useRef<HTMLDivElement>(null),title=useRef<HTMLHeadingElement>(null);
 const l=(cn:string,en:string)=>zh?cn:en;
 const [platform,setPlatform]=useState<GuidePlatform>("chatgpt"),tabsId=useId();
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow="hidden";title.current?.focus({preventScroll:true});
  return()=>{document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 return createPortal(<div className="file-import-guide-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
  <div ref={panel} className="file-import-guide" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event=>{
   if(event.key==="Escape"){event.stopPropagation();onClose();return;}
   if(event.key!=="Tab")return;
   const items=[...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),a[href],summary')].filter(element=>!Array.from(panel.current!.querySelectorAll("details:not([open])")).some(details=>details.contains(element)&&element!==details.querySelector("summary")));
   const first=items[0],last=items.at(-1),index=items.indexOf(document.activeElement as HTMLElement);
   if(index<0||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){event.preventDefault();(event.shiftKey?last:first)?.focus();}
  }}>
   <header className="file-import-guide-header"><div><span className="file-import-guide-eyebrow">ChatAtlas</span><h2 ref={title} id={titleId} tabIndex={-1}>{l("导入 AI 对话","Import AI conversations")}</h2></div><button type="button" className="file-import-guide-close" aria-label={l("关闭导入教程","Close import guide")} onClick={onClose}><X size={20}/></button></header>
   <div ref={body} className="file-import-guide-body">
    <div className="file-import-guide-tabs" role="tablist" aria-label={l("对话来源","Conversation source")}>{GUIDE_PLATFORMS.map((item,index)=><button key={item.id} type="button" role="tab" id={`${tabsId}-${item.id}`} tabIndex={platform===item.id?0:-1} aria-selected={platform===item.id} aria-controls={`${tabsId}-panel`} onClick={()=>{setPlatform(item.id);if(body.current)body.current.scrollTop=0;}} onKeyDown={event=>{
     const next=event.key==="ArrowRight"?(index+1)%GUIDE_PLATFORMS.length:event.key==="ArrowLeft"?(index+GUIDE_PLATFORMS.length-1)%GUIDE_PLATFORMS.length:event.key==="Home"?0:event.key==="End"?GUIDE_PLATFORMS.length-1:undefined;
     if(next===undefined)return;event.preventDefault();setPlatform(GUIDE_PLATFORMS[next].id);document.getElementById(`${tabsId}-${GUIDE_PLATFORMS[next].id}`)?.focus();if(body.current)body.current.scrollTop=0;
    }}>{l(item.zh,item.en)}</button>)}</div>
    <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${platform}`}>
    {platform!=="chatgpt"?<OtherPlatformGuide platform={platform} l={l}/>:<>
    <div className="file-import-guide-path" aria-label={l("导出入口","Export location")}><span>{l("设置","Settings")}</span><span aria-hidden="true">›</span><span>{l("数据控制","Data controls")}</span><span aria-hidden="true">›</span><strong>{l("导出数据","Export data")}</strong></div>
    <ol className="file-import-guide-steps">
     <li><div><h3>{l("申请导出对话","Request your export")}</h3><p>{l("登录 ChatGPT，打开头像菜单 → 设置 → 数据控制 → 导出数据，确认导出。","Sign in to ChatGPT. Open your profile menu → Settings → Data controls → Export data, then confirm.")}</p><a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">{l("打开 ChatGPT","Open ChatGPT")}<ArrowUpRight size={14} aria-hidden="true"/></a></div></li>
     <li><div><h3>{l("下载导出文件","Download your export")}</h3><p>{l("收到邮件或短信通知后，用同一账号打开下载链接，保存 ZIP 文件。","When the email or SMS arrives, open the download link with the same account and save the ZIP.")}</p><div className="file-import-guide-timing"><span>{l("导出最长可能需要 7 天","Exports may take up to 7 days")}</span><span>{l("下载链接收到后 24 小时内有效","Download links expire after 24 hours")}</span></div></div></li>
     <li><div><h3>{l("选择文件，开始导入","Choose your file to import")}</h3><p>{l("点击下方按钮，选择原始 ZIP，无需解压；也支持其中的 conversations.json。","Use the button below to choose the original ZIP, without extracting it, or its conversations.json file.")}</p></div></li>
    </ol>
    <details className="file-import-guide-faq"><summary>{l("遇到问题？查看导出帮助","Need help? View export tips")}</summary>
     <details><summary>{l("一直没收到导出通知？","No export notification yet?")}</summary><p>{l("先检查绑定邮箱是否正确，以及垃圾邮件、推广邮件文件夹。已有导出请求正在处理时，请等待完成；超过 7 天仍未收到，可通过下方官方说明联系 OpenAI 支持。","Check your account email, spam and promotions folders. Wait for an existing export request to finish. If it has not arrived after 7 days, use the official guide below to contact OpenAI Support.")}</p></details>
     <details><summary>{l("找不到「导出数据」？","Cannot find Export data?")}</summary><p>{l("先确认已登录并选中了正确的账号或工作区。Business、Enterprise 和 Healthcare 工作区不提供自助导出；Edu 的可用性取决于权限和管理员设置，遇到限制请联系管理员。","Check your signed-in account and workspace. Business, Enterprise and Healthcare workspaces do not offer self-service export. Edu availability depends on role and administrator settings.")}</p></details>
     <details><summary>{l("下载链接过期或无法打开？","Download link expired or will not open?")}</summary><p>{l("确认浏览器登录的是申请导出的同一账号。链接过期后，需要在 ChatGPT 中重新申请导出。个人账号无法登录时，可通过 OpenAI 隐私门户申请账号数据。","Sign in to the account that requested the export. Request a new export if the link expired. If you cannot sign in to a personal account, you can request account data through the OpenAI Privacy Portal.")} <a href="https://privacy.openai.com/" target="_blank" rel="noopener noreferrer">{l("打开隐私门户","Privacy Portal")}<ArrowUpRight size={13} aria-hidden="true"/></a></p></details>
     <details><summary>{l("提示找不到对话文件？","No conversation file found?")}</summary><p>{l("请选择 ChatGPT 导出的原始 ZIP，或其中的 conversations.json 等对话 JSON 文件。chat.html、PDF、截图和其他账号 JSON 不是支持的对话文件；不要仅修改后缀名，下载不完整时请重新下载 ZIP。","Choose the original ChatGPT ZIP or a conversation JSON inside it, such as conversations.json. HTML, PDF, screenshots and unrelated account JSON files are not supported. Renaming the extension does not convert them; download the ZIP again if it is incomplete.")}</p></details>
    </details>
    <a className="file-import-guide-official" href={officialGuide} target="_blank" rel="noopener noreferrer">{l("查看 OpenAI 官方导出说明","OpenAI official export guide")}<ArrowUpRight size={14} aria-hidden="true"/></a>
    </>}
    </div>
   </div>
   <footer className="file-import-guide-footer"><button type="button" className="file-import-guide-choose" disabled={disabled} onClick={onChoose}><Upload size={16} aria-hidden="true"/>{l("选择文件导入","Choose file to import")}</button></footer>
  </div>
 </div>,document.body);
}

const step=(heading:string,body:ReactNode)=><li><div><h3>{heading}</h3>{body}</div></li>;
const external=(href:string,label:string)=><a href={href} target="_blank" rel="noopener noreferrer">{label}<ArrowUpRight size={14} aria-hidden="true"/></a>;
const markdownTemplate=(l:(cn:string,en:string)=>string)=>l("# 对话标题\n\n## 用户\n在这里粘贴你的问题\n\n## AI\n在这里粘贴 AI 的回答\n","# Conversation title\n\n## User\nPaste your question here\n\n## AI\nPaste the AI response here\n");
const jsonTemplate=(l:(cn:string,en:string)=>string)=>JSON.stringify({title:l("对话标题","Conversation title"),messages:[{role:"user",content:l("在这里粘贴你的问题","Paste your question here")},{role:"assistant",content:l("在这里粘贴 AI 的回答","Paste the AI response here")}]},null,2);
const templateDownload=(content:string,format:"md"|"json",label:string)=><a className="file-import-guide-template" download={`chatatlas-conversation.${format}`} href={`data:${format==="md"?"text/markdown":"application/json"};charset=utf-8,${encodeURIComponent(content)}`}><Download size={14} aria-hidden="true"/>{label}</a>;

/** Export steps for platforms without native ChatAtlas sync. Every path ends in
 * the same local file picker; formats are recognized by content, not by tab. */
function OtherPlatformGuide({platform,l}:{platform:Exclude<GuidePlatform,"chatgpt">;l:(cn:string,en:string)=>string}){
 const choose=(note:string)=>step(l("选择文件，开始导入","Choose your file to import"),<><p>{l("点击下方按钮，选择下载的 ZIP，无需解压。","Use the button below to choose the downloaded ZIP, without extracting it.")}</p><p className="file-import-guide-muted">{note}</p></>);
 if(platform==="claude")return <ol className="file-import-guide-steps">
  {step(l("打开 Claude 设置","Open Claude settings"),<><p>{l("登录要导出的 Claude 账号，进入「设置」（Settings）→「隐私」（Privacy）。","Sign in to the Claude account you want to export, then open Settings → Privacy.")}</p>{external("https://claude.ai/",l("打开 Claude","Open Claude"))}</>)}
  {step(l("申请导出数据","Request your export"),<p>{l("点击「导出数据」（Export data）并确认。Claude 会把下载链接发送到账号邮箱。","Select Export data and confirm. Claude emails a download link to your account address.")}</p>)}
  {step(l("从邮件下载 ZIP","Download the ZIP from the email"),<p>{l("用申请导出的同一账号打开邮件中的链接，下载 ZIP 文件。","Open the link while signed in to the same account and download the ZIP.")}</p>)}
  {choose(l("也支持其中的 conversations.json。Artifact 内容作为正文保留，思考过程和工具调用不导入。","The conversations.json inside it also works. Artifact content is kept; thinking and tool traffic are not imported."))}
 </ol>;
 if(platform==="gemini")return <><ol className="file-import-guide-steps">
  {step(l("打开 Google Takeout","Open Google Takeout"),<><p>{l("登录使用 Gemini 的 Google 账号，先点击「取消全选」。","Sign in to the Google account you use with Gemini and select Deselect all.")}</p>{external("https://takeout.google.com/",l("打开 Google Takeout","Open Google Takeout"))}</>)}
  {step(l("只导出 Gemini 活动","Export only Gemini activity"),<p>{l("勾选「我的活动」（My Activity），在活动数据选项中只保留 Gemini Apps，并把格式从 HTML 改为 JSON。","Select My Activity, keep only Gemini Apps in its activity options, and change the format from HTML to JSON.")}</p>)}
  {step(l("下载 ZIP","Download the ZIP"),<p>{l("创建导出后，按 Google 的通知下载 ZIP 文件。","Create the export and download the ZIP when Google notifies you.")}</p>)}
  {choose(l("也支持其中 Gemini Apps 的 JSON 文件。HTML 格式无法识别，请导出 JSON。","The Gemini Apps JSON inside it also works. HTML exports cannot be read; choose JSON."))}
 </ol><p className="file-import-guide-muted">{l("Takeout 只记录每次提问和回答，不包含对话编号。ChatAtlas 会把间隔不超过 30 分钟的相邻提问合成一段阅读材料，它不一定等于 Gemini 里的原对话；未开启 Gemini 应用活动记录时没有内容。","Takeout records each prompt and answer without conversation IDs. ChatAtlas groups prompts no more than 30 minutes apart into one reading session, which may differ from the original Gemini chat. Nothing is exported while Gemini Apps Activity is off.")}</p></>;
 if(platform==="deepseek")return <ol className="file-import-guide-steps">
  {step(l("打开 DeepSeek 设置","Open DeepSeek settings"),<><p>{l("登录 DeepSeek 网页版，在设置中找到数据管理或导出数据。","Sign in to DeepSeek on the web and find data management or data export in settings.")}</p>{external("https://chat.deepseek.com/",l("打开 DeepSeek","Open DeepSeek"))}</>)}
  {step(l("导出全部对话","Export all conversations"),<p>{l("申请导出所有历史对话，并下载生成的文件。","Request an export of all conversations and download the file.")}</p>)}
  {choose(l("也支持其中的 conversations.json。思考过程和联网搜索内容不导入。如果提示无法识别，请反馈导出文件的结构（删除正文）。","The conversations.json inside it also works. Reasoning and web-search fragments are not imported. If the file is not recognized, please report its structure with message text removed."))}
 </ol>;
 return <>
  <div className="file-import-guide-formats"><FileArchive size={22} aria-hidden="true"/><div><strong>{l("直接选择导出的对话文件","Choose your exported conversation file")}</strong><p>{l("ZIP / JSON / Markdown / TXT","ZIP / JSON / Markdown / TXT")}</p></div></div>
  <p className="file-import-guide-direct-note">{l("先试试原文件，ChatAtlas 会自动识别支持的对话格式，无需先套模板或手动改写。ZIP 无需解压，可一次导入其中的多份对话。","Try the original file first. ChatAtlas detects supported conversation formats without a template or manual conversion. ZIP files can contain multiple conversations and need no extraction.")}</p>
  <details className="file-import-guide-faq"><summary>{l("还没有导出文件？","No export file yet?")}</summary><p>{l("如果来源平台或你使用的对话导出工具提供文件下载，优先选择 JSON、Markdown 或 TXT。目前这里通过文件导入，不能直接读取其他 AI 账号的历史记录。","If your AI platform or conversation export tool offers a download, choose JSON, Markdown or TXT. This entry imports files; it does not read other AI accounts directly.")}</p></details>
  <details className="file-import-guide-faq"><summary>{l("高级：自定义对话文件","Advanced: custom conversation files")}</summary><p>{l("仅在需要自己制作文件时使用，普通文件导入无需填写模板。","Only for creating your own file. Templates are optional for normal imports.")}</p><pre className="file-import-guide-example">{markdownTemplate(l)}</pre>{templateDownload(markdownTemplate(l),"md",l("下载 Markdown 模板","Download Markdown template"))}<details><summary>{l("使用 JSON 格式","Use JSON format")}</summary><p>{l("每条消息包含 role（user / assistant）和 content；多个对话可放在数组中。title 和 platform 为可选字段。","Each message needs role (user/assistant) and content. Use an array for multiple conversations. title and platform are optional.")}</p><pre className="file-import-guide-example">{jsonTemplate(l)}</pre>{templateDownload(jsonTemplate(l),"json",l("下载 JSON 模板","Download JSON template"))}</details></details>
 </>;
}
