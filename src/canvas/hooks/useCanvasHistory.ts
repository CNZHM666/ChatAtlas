import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasCard, CanvasEdge } from "../../shared/types";
import { listCards, saveCards } from "../../storage/cards";
import { listEdges, saveEdges } from "../../storage/edges";

interface Snapshot {
  cards: CanvasCard[];
  edges: CanvasEdge[];
}
const EMPTY_SNAPSHOT: Snapshot = { cards: [], edges: [] };

const clone = (state: Snapshot): Snapshot => ({ cards: state.cards.map((card) => ({ ...card })), edges: state.edges.map((edge) => ({ ...edge })) });

export function useCanvasHistory(canvasId: string, enabled = true) {
  const [state, setState] = useState<Snapshot>({ cards: [], edges: [] });
  const [ready, setReady] = useState(false);
  const [loadedCanvasId, setLoadedCanvasId] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const dragStart = useRef<Snapshot | null>(null);
  const latestState = useRef(state);
  const persistedState = useRef<Snapshot | null>(null);
  latestState.current = state;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setReady(false);
    past.current = [];
    future.current = [];
    setHistoryVersion((value) => value + 1);
    void Promise.all([listCards(canvasId), listEdges(canvasId)])
      .then(([cards, edges]) => {
        if (!live) return;
        const loaded = { cards, edges };
        persistedState.current = loaded;
        setState(loaded);
      })
      .catch(() => {
        // The canvas remains usable with in-memory mock data if IndexedDB is unavailable.
      })
      .finally(() => {
        if (live) {
          setLoadedCanvasId(canvasId);
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, [canvasId, enabled]);

  useEffect(() => {
    if (!ready || loadedCanvasId !== canvasId || dragStart.current || state === persistedState.current) return;
    const timer = window.setTimeout(() => {
      void Promise.all([saveCards(canvasId, state.cards), saveEdges(canvasId, state.edges)]).then(() => { persistedState.current = state; });
    }, 240);
    return () => window.clearTimeout(timer);
  }, [canvasId, loadedCanvasId, ready, state]);

  const mutate = useCallback((producer: (current: Snapshot) => Snapshot) => {
    setState((current) => {
      past.current.push(clone(current));
      if (past.current.length > 60) past.current.shift();
      future.current = [];
      setHistoryVersion((value) => value + 1);
      return producer(current);
    });
  }, []);

  const updatePositions = useCallback((updates: Array<{ id: string; x: number; y: number }>) => {
    const positions = new Map(updates.map((item) => [item.id, item]));
    setState((current) => ({
      ...current,
      cards: current.cards.map((card) => {
        const position = positions.get(card.id);
        return position ? { ...card, x: position.x, y: position.y, updatedAt: Date.now(), layoutLocked: true } : card;
      }),
    }));
  }, []);

  const updateCardNotes = useCallback((id: string, notes: string) => {
    setState((current) => ({
      ...current,
      cards: current.cards.map((card) => card.id === id ? { ...card, notes, description: card.origin === "user" ? notes : card.description, updatedAt: Date.now() } : card),
    }));
  }, []);

  const saveNow = useCallback(async () => {
    const snapshot = latestState.current;
    await Promise.all([saveCards(canvasId, snapshot.cards), saveEdges(canvasId, snapshot.edges)]);
    persistedState.current = snapshot;
  }, [canvasId]);

  const beginDrag = useCallback(() => {
    dragStart.current = clone(state);
  }, [state]);

  const finishDrag = useCallback(() => {
    const origin = dragStart.current;
    if (!origin) return;
    dragStart.current = null;
    past.current.push(origin);
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    setHistoryVersion((value) => value + 1);
  }, []);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    setState((current) => {
      future.current.push(clone(current));
      return previous;
    });
    setHistoryVersion((value) => value + 1);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    setState((current) => {
      past.current.push(clone(current));
      return next;
    });
    setHistoryVersion((value) => value + 1);
  }, []);

  return useMemo(() => ({
    ...(loadedCanvasId === canvasId ? state : EMPTY_SNAPSHOT),
    ready: ready && loadedCanvasId === canvasId,
    mutate,
    updatePositions,
    updateCardNotes,
    saveNow,
    beginDrag,
    finishDrag,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    historyVersion,
  }), [state, ready, canvasId, loadedCanvasId, mutate, updatePositions, updateCardNotes, saveNow, beginDrag, finishDrag, undo, redo, historyVersion]);
}
