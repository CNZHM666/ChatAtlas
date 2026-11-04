import { ChevronDown } from "lucide-react";

/** A shared native disclosure heading; the enclosing details owns its open state. */
export function WorkspaceDisclosureTitle({ label, count, compact = false }: { label: string; count?: number; compact?: boolean }) {
  return <summary className={`workspace-disclosure-title${compact ? " is-compact" : ""}`}><span>{label}</span>{count !== undefined ? <small>{count}</small> : null}<ChevronDown size={15} aria-hidden="true" /></summary>;
}
