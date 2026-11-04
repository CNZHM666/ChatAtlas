import { useEffect, useState, type ReactNode } from "react";

export function ChapterPhase({ title, count, active, searching, children }: { title: string; count: number; active: boolean; searching: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(active);
  useEffect(() => { if (active) setOpen(true); }, [active]);
  return <details className="chapter-phase" open={open || searching} onToggle={(event) => setOpen(event.currentTarget.open)}><summary><strong>{title}</strong><span>{count}</span></summary>{open || searching ? children : null}</details>;
}
