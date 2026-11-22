import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** A shared native disclosure heading; the enclosing details owns its open state. */
export function WorkspaceDisclosureTitle({ label, count, compact = false, icon: Icon }: { label: ReactNode; count?: number; compact?: boolean; icon?: LucideIcon }) {
  return <summary className={`workspace-disclosure-title${compact ? " is-compact" : ""}`}>{Icon ? <span className="disclosure-icon" aria-hidden="true"><Icon size={15}/></span> : null}<span>{label}</span>{count !== undefined ? <small>{count}</small> : null}<ChevronDown size={15} aria-hidden="true" /></summary>;
}
