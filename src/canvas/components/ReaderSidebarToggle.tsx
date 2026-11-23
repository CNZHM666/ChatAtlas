import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

export function ReaderSidebarToggle({ zh, collapsed = false, side = "left", onToggle, id, controls, className }: {
  zh: boolean;
  collapsed?: boolean;
  side?: "left" | "right";
  onToggle?: () => void;
  id?: string;
  controls?: string;
  className?: string;
}) {
  const label = collapsed ? (zh ? "展开侧边栏" : "Expand sidebar") : (zh ? "收起侧边栏" : "Collapse sidebar");
  const Icon = side === "left"
    ? (collapsed ? PanelLeftOpen : PanelLeftClose)
    : (collapsed ? PanelRightOpen : PanelRightClose);
  return <button type="button" id={id} className={`conversation-sidebar-toggle${className ? ` ${className}` : ""}`}
    onClick={onToggle} aria-label={label} title={label} aria-expanded={!collapsed} aria-controls={controls}>
    <Icon size={18} aria-hidden="true" />
  </button>;
}
