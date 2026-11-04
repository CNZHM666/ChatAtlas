import { createContext, useContext, type ReactNode } from "react";

export const DiagramWorkspaceContext = createContext(false);
export const useFullDiagram = () => useContext(DiagramWorkspaceContext);
export const DiagramHeaderContext = createContext<{ heading: HTMLElement | null; toolbar: HTMLElement | null; settingsActions?: ReactNode }>({ heading: null, toolbar: null });
