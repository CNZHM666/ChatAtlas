import type { WikiProgress } from "./wiki-knowledge";

export interface WikiPlanningProgress {
  completedWindows:number;
  totalWindows:number;
  reusedWindows:number;
  confirmedAssignments:number;
  pendingAssignments:number;
  quarantinedReferences:number;
  /** Chapter merging after every batch is planned: each round can take a minute. */
  merging?:{round:number;chapters:number;target:number};
}
/** Analysis progress counts completed source batches, independently of Reader understanding. */
export interface FocusAnalysisProgress {
  completed: number;
  total: number;
  stage: "reading" | "synthesis" | "project" | "verification";
  /** Final directory reconciliation after overlapping reading/catalogue work, before writing. */
  phase?: "directory";
  /** The knowledge-unit ledger's current step (extract, the parts of organizing, write) and its count. */
  ledger?: WikiProgress;
  directory?:WikiPlanningProgress;
  final: boolean;
  round: number;
  completedSourceIds: string[];
  totalSources: number;
  processedSegments: number;
  totalSegments: number;
  elapsedMs: number;
  reusedBatches?: number;
  /** Composition resumed from a source-validated local checkpoint. */
  resumed?:boolean;
  /** Verified article previews, not raw streamed JSON or provisional notes. */
  readyChapters?: number;
  firstPreviewMs?: number;
  /** Known pending work, plus one estimated composition step before the final round. */
  remainingSteps?: number;
  stepsEstimated?: boolean;
  recoverySplits?: number;
  /** Estimate for the current round only. Final composition has an unknown duration. */
  remainingMs?: number;
}
