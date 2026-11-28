import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import "../workbench-dialogs.css";

export function WorkbenchDialog({ title, description, closeLabel, className, children, onClose }: {
  title: string; description?: ReactNode; closeLabel: string; className: string; children: ReactNode; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    if (element && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.open = true;
    }
    return () => {
      if (element?.open && typeof element.close === "function") element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className={`workbench-dialog ${className}`} aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="workbench-dialog-frame">
      <header className="workbench-dialog-header">
        <div><h2 id={heading}>{title}</h2>{description && <p>{description}</p>}</div>
        <button autoFocus type="button" aria-label={closeLabel} title={closeLabel} onClick={onClose}><X size={19} aria-hidden="true"/></button>
      </header>
      {children}
    </div>
  </dialog>;
}
