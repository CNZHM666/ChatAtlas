import { ArrowLeft } from "lucide-react";
import { usePreferences } from "../preferences";

export function WorkspaceBackButton({ onClick, label, className = "" }: { onClick: () => void; label?: string; className?: string }) {
  const { locale } = usePreferences();
  return <button type="button" className={`workspace-back ${className}`} onClick={onClick}>
    <ArrowLeft size={16} aria-hidden="true" />{label ?? (locale === "zh-CN" ? "返回" : "Back")}
  </button>;
}
