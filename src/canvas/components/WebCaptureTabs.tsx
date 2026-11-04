import { useState } from "react";
import type { WebCapturePlatform, WebCaptureTab, WebPageState } from "../../shared/web-capture";
import { captureOpenTab, inspectPageCaptureTabs } from "../web-capture-client";
import {WebCaptureHistory} from "./WebCaptureHistory";

const LABELS: Record<WebPageState, [string,string]> = {
  ready:["可保存已加载消息","Loaded messages are ready"],
  streaming:["正在回复，结束后重新检测","Reply in progress; check again when finished"],
  empty:["未识别到消息，请确认已登录、加载对话或页面结构是否变化","No messages recognized. Check login, loading or changed page layout"],
  unsupported:["请打开一条已有对话","Open an existing conversation"],
  disconnected:["连接中断，请刷新该网页后重新检测","Disconnected. Reload the website and check again"],
  disabled:["采集已关闭","Capture is off"],
};
export function WebCaptureTabs({platform,zh}:{platform:WebCapturePlatform;zh:boolean}) {
  const [tabs,setTabs]=useState<WebCaptureTab[]>(),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  const [saved,setSaved]=useState<Record<number,number>>({});
  const inspect=async()=>{
    setBusy(true);setFailed(false);setSaved({});
    try{setTabs(await inspectPageCaptureTabs(platform));}catch{setTabs(undefined);setFailed(true);}finally{setBusy(false);}
  };
  const capture=async(tab:WebCaptureTab)=>{
    setBusy(true);setFailed(false);
    try{const result=await captureOpenTab(platform,tab);setSaved(value=>({...value,[tab.tabId]:result.summary?.messageCount??0}));}catch{setFailed(true);}finally{setBusy(false);}
  };
  return <div className="web-capture-tabs">
    <button type="button" className="import-button" disabled={busy} onClick={()=>void inspect()}>{busy?zh?"处理中…":"Working…":zh?"检测已打开的对话":"Check open conversations"}</button>
    {tabs?.length===0?<p>{zh?"没有打开的网站标签页。打开并登录网站，进入对话后再检测。":"No website tabs are open. Open the website, sign in and enter a conversation, then check again."}</p>:null}
    {tabs?.map(tab=><div className="web-capture-tab" key={tab.tabId}>
      <div><strong>{tab.title||tab.url}</strong><small>{LABELS[tab.state][zh?0:1]}{tab.messageCount>0?` · ${tab.messageCount} ${zh?"条消息":"messages"}`:""}</small></div>
      {Object.hasOwn(saved,tab.tabId)?<span role="status">{zh?`已保存 ${saved[tab.tabId]} 条`:`Saved ${saved[tab.tabId]} messages`}</span>:tab.state==="ready"?<button type="button" className="import-button" disabled={busy} onClick={()=>void capture(tab)}>{zh?"保存当前已加载内容":"Save loaded messages"}</button>:null}
    </div>)}
    {failed?<p role="alert">{zh?"未完成操作。请确认网站权限仍开启、对话已加载，再重新检测。已保存的内容会保留。":"Could not finish. Check website access and conversation loading, then check again. Saved content is retained."}</p>:null}
    {tabs&&tabs.length>0?<details className="web-capture-history-disclosure"><summary>{zh?"导入网页历史":"Import website history"}</summary><WebCaptureHistory platform={platform} tabs={tabs} zh={zh}/></details>:null}
  </div>;
}
