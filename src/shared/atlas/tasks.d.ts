export const TASKS: Readonly<Record<string, { route: string; field: string; instruction: string; output: string }>>;
export function parseStructuredJson(text: string): unknown;
export const OUTPUT_SHAPES: Readonly<Record<string, unknown>>;
export function normalizeFocusOutput(value: unknown, data: Record<string, unknown>): unknown;
export function focusOutputIssue(value: unknown, data: Record<string, unknown>): string | null;
export function focusOutputLanguagePaths(value: unknown, data: Record<string, unknown>): string[];
export interface FocusCitationDiagnostics { allowedEvidenceCount: number; unknownEvidenceCount: number; citationPaths: string[]; returnedSectionCount?: number; returnedNoteCount?: number }
export function focusWireData(data: Record<string, unknown>): Record<string, unknown>;
export function decodeFocusWireOutput(value: unknown, data: Record<string, unknown>): { value: unknown; issue: string | null; diagnostics?: FocusCitationDiagnostics };
export function focusOutputDiagnostics(value: unknown, data: Record<string, unknown>): FocusCitationDiagnostics;
export function outputTokenLimit(taskType: string, data?: Record<string, unknown>): number;
export function taskMessages(taskType: string, data: Record<string, unknown>, repair?: boolean, compactSources?: boolean): Array<{ role: "system" | "user"; content: string }>;

export { projectProofBlocks } from "./project-knowledge.js";
