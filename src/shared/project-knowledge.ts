import type { ProjectSource, ProjectState } from "./project-state";
export interface ProjectKnowledgeBatch { sourceIds: string[]; facts?: ProjectState; sources?: ProjectSource[]; scopeSignature?: string }
export interface ProjectKnowledge { version: 1; signature: string; batches: ProjectKnowledgeBatch[] }
