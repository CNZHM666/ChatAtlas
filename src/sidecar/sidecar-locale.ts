import { useEffect, useState } from "react";

export function useSidecarLocale(fallback: boolean): [boolean, () => void] {
  const [zh, setZh] = useState(() => {
    try { const saved = localStorage.getItem("atlas-locale"); return saved === "zh-CN" ? true : saved === "en" ? false : fallback; }
    catch { return fallback; }
  });
  useEffect(() => { document.documentElement.lang = zh ? "zh-CN" : "en"; }, [zh]);
  return [zh, () => setZh(previous => {
    const next = !previous;
    try { localStorage.setItem("atlas-locale", next ? "zh-CN" : "en"); } catch { /* Language still changes for this panel. */ }
    return next;
  })];
}
