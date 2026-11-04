import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { SidecarProject } from "./SidecarProject";
import { NativeSidecar } from "./NativeSidecar";
import { useSidecarLocale } from "./sidecar-locale";
import {preferredTheme} from "../shared/appearance";
import {preferredOutputLocale} from "../shared/output-locale";
import {nativePanelTabId} from "../shared/sidecar-scope";
import { installBrandFavicon } from "../shared/brand-assets";
import "../canvas/styles.css";
import "../canvas/reading-workspace.css";
import "katex/dist/katex.min.css";
import "./sidecar.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.has("theme")?params.get("theme")==="dark"?"dark":"light":preferredTheme();
installBrandFavicon();
const zh = params.has("lang")?params.get("lang")==="zh":preferredOutputLocale()==="zh-CN";
document.documentElement.lang = zh ? "zh-CN" : "en";
function EmbeddedSidecar() {
  const [chinese,toggleLanguage]=useSidecarLocale(zh);
  return <SidecarProject onToggleLanguage={toggleLanguage} canInsert conversationId={params.get("conversation") ?? ""} conversationTitle={params.get("title") ?? ""} zh={chinese}/>;
}
export function SidecarPage() {
  useEffect(() => {
    // The host may supply appearance/visibility only. Never exchange source text or credentials.
    const listener = (event: MessageEvent) => {
      if (event.source !== null && event.source !== parent || event.origin !== "https://chatgpt.com" || event.data?.type !== "ATLAS_SIDECAR_APPEARANCE") return;
      if (event.data.theme === "light" || event.data.theme === "dark") document.documentElement.dataset.theme = event.data.theme;
    };
    window.addEventListener("message", listener); return () => window.removeEventListener("message", listener);
  }, []);
  return params.get("native")==="1"?<NativeSidecar zh={zh} tabId={nativePanelTabId(params.get("tabId"))}/>:<EmbeddedSidecar/>;
}
createRoot(document.getElementById("root")!).render(<SidecarPage />);
