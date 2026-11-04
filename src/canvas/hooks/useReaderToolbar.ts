import { createContext, useContext, useLayoutEffect, type RefObject } from "react";

type ToolbarContext = { host: HTMLElement | null; active: string; setHost: (host: HTMLDivElement | null) => void; register: (id: string, element: HTMLElement) => () => void };
export const ReaderToolbarContext = createContext<ToolbarContext | null>(null);

export function useReaderToolbar(id: string, root: RefObject<HTMLElement>, enabled: boolean) {
  const context = useContext(ReaderToolbarContext), register = context?.register;
  useLayoutEffect(() => {
    if (!enabled || !register || !root.current) return;
    return register(id, root.current);
  }, [enabled, register, id, root]);
  return context;
}
