import { ArrowUpRight, Database } from "lucide-react";

export function SidecarLibraryFooter({ zh, count, onOpen }: {
  zh: boolean; count: number; onOpen: () => void;
}) {
  return <footer className="sidecar-library-footer">
    <div className="sidecar-project-footer">
      <small title={zh ? `${count} 条已导入对话` : `${count} imported chats`}><Database size={13}/>{count===0?(zh?"暂无对话":"No chats yet"):zh ? `${count} 条已导入对话` : `${count} ${count === 1 ? "chat" : "chats"}`}</small>
      <button className="sidecar-text-button" aria-label={zh ? "打开工作台" : "Open workbench"} onClick={onOpen}>{zh ? "工作台" : "Workbench"}<ArrowUpRight size={14}/></button>
    </div>
  </footer>;
}
