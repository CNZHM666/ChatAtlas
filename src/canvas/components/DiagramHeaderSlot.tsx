import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DiagramHeaderContext } from "../diagram-workspace-context";

/** Share one header in preview and full view without duplicating control state. */
export function DiagramHeaderSlot({ children, toolbar = false }: { children: ReactNode; toolbar?: boolean }) {
  const targets = useContext(DiagramHeaderContext);
  const target = toolbar ? targets.toolbar : targets.heading;
  return target ? createPortal(children, target) : children;
}
