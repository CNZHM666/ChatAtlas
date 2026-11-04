import { ArrowLeft } from "lucide-react";

export function ReaderBackButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return <button type="button" className={`conversation-back reader-back-button ${className}`} onClick={onClick}><ArrowLeft size={16} aria-hidden="true" /><span>{label}</span></button>;
}
