import type { HTMLAttributes, ReactNode } from "react";
import type { ConversationGraphNodeKind } from "../../shared/types";

interface SemanticCardProps extends HTMLAttributes<HTMLElement> {
  kind: ConversationGraphNodeKind;
  selected?: boolean;
  dragging?: boolean;
  children: ReactNode;
}

/** Shared interactive shell; content and metadata remain specific to each semantic variant. */
export function SemanticCard({ kind, selected, dragging, children, className = "", ...rest }: SemanticCardProps) {
  return <article {...rest} className={`semantic-card semantic-${kind} ${selected ? "is-selected" : ""} ${dragging ? "is-dragging" : ""} ${className}`}>{children}</article>;
}
