import { ArrowUpRight, Quote } from "lucide-react";
import type { FocusEvidence, FocusSection } from "../../shared/focus-session";
import { continuationStatus, sidecarRecordStatus } from "../../shared/project-continuation";
import { ReaderGuide } from "./ReaderGuide";
import "../project-conversation-notes.css";

export function ProjectConversationNotes({ notes, evidence, zh, onRead, onSource, compact = false }: {
  notes: FocusSection[];
  evidence: FocusEvidence[];
  zh: boolean;
  onRead: (id: string) => void;
  onSource?: (ref: FocusEvidence, note: FocusSection) => void;
  compact?: boolean;
}) {
  if (!notes.length) return null;
  const sources = new Map(evidence.map(ref => [ref.id, ref]));
  return <ul className="project-notes" aria-label={zh ? "项目记录" : "Project notes"}>
    {notes.map(note => {
      const refs = note.evidenceIds.flatMap(id => sources.get(id) ?? []);
      const label = compact ? sidecarRecordStatus(note, zh) : continuationStatus(note, zh);
      return <li key={note.id}>
        <div className="project-note-content">
          {compact ? <div className="native-note-heading"><button type="button" className="native-tool" onClick={() => onRead(note.id)} title={note.title}>{note.title}</button>{label && <small>{label}</small>}</div>
            : <span className="project-note-status">{label}</span>}
          <ReaderGuide content={note.body} zh={zh} complete hideCitationAnnotations/>
        </div>
        <div className="project-note-actions">
          {refs.length === 1 && onSource && <button type="button" aria-label={zh ? `查看「${note.title}」的原话` : `Source for ${note.title}`}
            title={zh ? "查看原话" : "See source"} onClick={() => onSource(refs[0], note)}><Quote size={15} aria-hidden="true"/></button>}
          {!compact && <button type="button" aria-label={zh ? `打开「${note.title}」` : `Open ${note.title}`} title={note.title}
            onClick={() => onRead(note.id)}><ArrowUpRight size={15} aria-hidden="true"/></button>}
        </div>
      </li>;
    })}
  </ul>;
}
