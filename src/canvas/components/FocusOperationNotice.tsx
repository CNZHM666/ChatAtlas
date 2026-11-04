import {AlertCircle,Settings2,X} from "lucide-react";
import {Children,type ReactNode} from "react";

/** One contextual action; expanded diagnostics never rearrange the toolbar.
 * Reading order: what happened, why, what retrying keeps, then the actions;
 * diagnostics stay collapsed below them. */
export function FocusOperationNotice({zh,title,message,note,children,action,onSettings,onDismiss}:{zh:boolean;title:string;message:string;note?:ReactNode;children?:ReactNode;action?:{label:string;run:()=>void;disabled?:boolean};onSettings?:()=>void;onDismiss:()=>void}) {
  return <section className="focus-operation-notice" role="alert" aria-label={title}>
    <span className="focus-operation-icon" aria-hidden="true"><AlertCircle size={18}/></span>
    <div className="focus-operation-body">
      <div className="focus-operation-copy"><strong>{title}</strong><p>{message}</p>{note?<div className="focus-operation-note">{note}</div>:null}</div>
      {action||onSettings?<div className="focus-operation-actions">
        {action?<button type="button" className="primary" disabled={action.disabled} onClick={action.run}>{action.label}</button>:null}
        {onSettings?<button type="button" className="focus-operation-settings" onClick={onSettings}><Settings2 size={15} aria-hidden="true"/>{zh?"AI 设置":"AI settings"}</button>:null}
      </div>:null}
      {Children.toArray(children).length?<div className="focus-operation-details">{children}</div>:null}
    </div>
    <button type="button" className="focus-operation-dismiss" aria-label={zh?"关闭提示":"Dismiss error"} onClick={onDismiss}><X size={18} aria-hidden="true"/></button>
  </section>;
}
