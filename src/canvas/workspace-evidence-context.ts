import type { EvidenceAttention } from "../shared/claim-meaning";
import { createContext } from "react";
import type { FocusEvidence } from "../shared/focus-session";
import type { WikiClaimSource } from "../shared/wiki-chapter-status";

/** One checkable point: a claim in the prose and only the originals that support it. */
export interface EvidencePoint { key: string; claim: string; quote?: string; source: WikiClaimSource; label?: string; reference: FocusEvidence; references: FocusEvidence[]; placed: boolean;
  /** Matched locally by wording overlap, not a saved claim-to-source link. */
  approximate?: boolean;
  /** Who holds the claim's sentence, and whether its marker is the labelled end of a run of one holder. */
  holder?: import("../shared/wiki-holder").WikiHolder; holderMark?: boolean;
  /** Why this point needs the reader's look; points without it passed the local check (their quote is in the original). */
  attention?: EvidenceAttention;
  /** The user answered it while checking: it is not asked about again. */
  checked?: boolean }
/** A point only the user can settle, not yet answered: a local check flagged it (written as decided with no
 * confirmation, a quote not found, a negation dropped…), or it is still open. Every other point has its original found
 * and needs no answer: checking asks about these, not about every sentence. */
export const needsConfirmation = (point: { attention?: EvidenceAttention; holder?: string; checked?: boolean }) => !point.checked && (Boolean(point.attention) || point.holder === "open");
export interface WorkspaceEvidenceOptions { references?: FocusEvidence[]; quote?: string; claim?: string; sectionId?:string;
  /** The original the panel shows now, so the document can highlight the claims that cite it. */
  shown?: FocusEvidence;
  /** Point-by-point checking: the panel steps through these instead of the whole chapter's sources. */
  points?: EvidencePoint[]; pointIndex?: number }

export const WorkspaceEvidenceContext = createContext<{
  close?: () => void;
  open: (ref: FocusEvidence, options?: WorkspaceEvidenceOptions) => void;
  /** What the open panel is showing, so the prose can mark the active point. */
  active?: WorkspaceEvidenceOptions;
} | undefined>(undefined);
