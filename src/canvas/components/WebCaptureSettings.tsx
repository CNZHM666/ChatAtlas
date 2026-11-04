import { useEffect, useState } from "react";
import { Globe2, ArrowUpRight, ChevronDown } from "lucide-react";
import { WEB_CAPTURE_PLATFORMS, WEB_CAPTURE_KEY, type WebCapturePlatform, type WebCaptureStatus } from "../../shared/web-capture";
import { pageCaptureAvailable, readPageCaptureStatus, setPageCapture } from "../web-capture-client";
import "../web-capture-settings.css";
import { WebCaptureTabs } from "./WebCaptureTabs";
import { platformName } from "../../shared/platforms";

export function WebCaptureSettings({zh}:{zh:boolean}){
  const [expanded,setExpanded]=useState<WebCapturePlatform>();
  const [statuses,setStatuses]=useState<WebCaptureStatus[]>([]),[busy,setBusy]=useState<WebCapturePlatform>(),[error,setError]=useState<"read"|"denied"|"update">();
  useEffect(()=>{
    let live=true;
    const reload=()=>{void readPageCaptureStatus().then(value=>{if(live)setStatuses(value);}).catch(()=>{if(live)setError("read");});};
    const changed=(changes:Record<string,chrome.storage.StorageChange>,area:string)=>{if(area==="local"&&changes[WEB_CAPTURE_KEY])reload();};
    reload();if(typeof chrome!=="undefined")chrome.storage?.onChanged?.addListener(changed);
    return()=>{live=false;if(typeof chrome!=="undefined")chrome.storage?.onChanged?.removeListener(changed);};
  },[zh]);
  const toggle=async(platform:WebCapturePlatform,enabled:boolean)=>{
    if(busy)return;setBusy(platform);setError(undefined);
    try{setStatuses(await setPageCapture(platform,enabled));}catch(failure){const denied=failure instanceof Error&&failure.message==="Website access was not granted";setError(denied?"denied":"update");}finally{setBusy(undefined);}
  };
  return <section className="web-capture-settings" aria-label={zh?"网页自动采集":"Automatic page capture"}>
    <header><Globe2 size={18}/><h3>{zh?"网页自动采集":"Automatic page capture"}</h3><small>{zh?"试用":"Beta"}</small></header>
    <p>{zh?"网站授权后自动保存已加载消息，可随时暂停；更早的历史可能尚未加载。":"Automatically saves loaded messages after website permission. Pause anytime; earlier history may be missing."}</p>
    <details className="web-capture-help"><summary>{zh?"采集说明":"About capture"}</summary><p>{zh?"采集不调用 AI，也不自动更新整理文档。支持侧栏、项目关联与原文定位；长对话可在原网站加载更早消息，或导入对话文件。":"Capture makes no AI calls or automatic document updates. Supports the side panel, project association and source location. Load earlier messages on the website or import files for long chats."}</p></details>
    {WEB_CAPTURE_PLATFORMS.map(site=>{
      const status=statuses.find(item=>item.platform===site.id),enabled=Boolean(status?.enabled&&status.permitted),open=expanded===site.id,name=platformName(site.id,zh?"zh-CN":"en");
      return <div className="web-capture-platform" key={site.id}>
        <div className="web-capture-setting">
          <div><strong>{name}</strong><small>{!status?zh?"读取中…":"Loading…":enabled?zh?"自动采集":"Automatic capture":!status.permitted?zh?"待授权":"Website access needed":zh?"已暂停":"Paused"}</small></div>
          <div className="web-capture-controls">
            <button type="button" className="web-capture-manage" aria-expanded={open} aria-controls={`capture-${site.id}`} aria-label={`${name} ${zh?"管理采集":"capture options"}`} onClick={()=>setExpanded(open?undefined:site.id)}>{zh?"管理":"Manage"}<ChevronDown size={13}/></button>
            <button type="button" className="web-capture-toggle" role="switch" aria-checked={enabled} aria-label={`${name} ${zh?"自动采集":"automatic capture"}`} title={enabled?zh?"暂停采集":"Pause capture":status?.permitted?zh?"恢复采集":"Resume capture":zh?"授予网站权限":"Grant website access"} disabled={!pageCaptureAvailable()||Boolean(busy)||!statuses.length} onClick={()=>void toggle(site.id,!enabled)}><span/></button>
          </div>
        </div>
        {open?<div className="web-capture-options" id={`capture-${site.id}`}>
          <div className="web-capture-links"><a href={site.origin} target="_blank" rel="noopener noreferrer">{zh?"打开网站":"Open website"}<ArrowUpRight size={12}/></a>{site.id==="qwen"?<a href="https://chat.qwen.ai" target="_blank" rel="noopener noreferrer">{zh?"Qwen 国际站":"Qwen international"}<ArrowUpRight size={12}/></a>:null}</div>
          {enabled?<WebCaptureTabs platform={site.id} zh={zh}/>:<p>{status?.permitted?zh?"已暂停，开启开关后恢复自动采集。":"Paused. Use the switch to resume capture.":zh?"使用开关授予网站权限后，采集会自动运行。":"Use the switch to grant website access and start automatic capture."}</p>}
        </div>:null}
      </div>;
    })}
    {!pageCaptureAvailable()?<small>{zh?"请在已安装的浏览器扩展中开启。":"Enable this in the installed browser extension."}</small>:null}
    {error?<p role="alert">{error==="read"?zh?"读取采集设置失败，请重新打开设置。":"Could not read capture settings. Reopen settings.":error==="denied"?zh?"未获得该网站的访问权限，自动采集保持关闭。":"Website access was not granted. Capture remains off.":zh?"修改采集设置失败，请重新打开设置后重试。":"Could not update capture settings. Reopen settings and try again."}</p>:null}
  </section>;
}
