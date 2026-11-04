import { Settings } from "lucide-react";
import { useEffect, useRef } from "react";
import { BrandMark } from "../shared/BrandMark";

export function SidecarHeader({ zh, onToggleLanguage, showBrand = true }: { zh: boolean; onToggleLanguage: () => void; showBrand?: boolean }) {
  const menu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node))menu.current?.removeAttribute("open");};document.addEventListener("pointerdown",outside);return()=>document.removeEventListener("pointerdown",outside);},[]);
  return <div className={`native-sidecar-header${showBrand ? "" : " sidecar-inline-controls"}`}>{showBrand ? <strong><BrandMark />ChatAtlas</strong> : null}
    <details ref={menu} className="sidecar-settings-menu" onKeyDown={event=>{if(event.key==="Escape"&&event.currentTarget.open){event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector("summary")?.focus();}}}>
      <summary aria-label={zh?"侧栏设置":"Sidebar settings"} title={zh?"侧栏设置":"Sidebar settings"}><Settings size={18}/></summary>
      <div><button className="sidecar-language-toggle" type="button" aria-label={zh ? "Switch to English" : "切换为中文"} onClick={onToggleLanguage}>{zh ? "English" : "简体中文"}</button>
      <button type="button" onClick={() => {menu.current?.removeAttribute("open");void chrome.runtime.sendMessage({ type: "ATLAS_OPEN_AI_SETTINGS" });}}>{zh?"AI 设置":"AI settings"}</button></div>
    </details>
  </div>;
}
