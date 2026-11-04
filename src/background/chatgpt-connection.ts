export interface ChatGPTTabCandidate {
  id?: number;
  url?: string;
  active?: boolean;
  lastAccessed?: number;
}

export interface ContentConnectionDeps {
  ping: () => Promise<boolean>;
  inject: () => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
}

/** Prefer the active/recent conversation page, then any recent ChatGPT page. */
export function selectChatGPTTab<T extends ChatGPTTabCandidate>(tabs: T[]): T | undefined {
  return tabs.filter((tab) => typeof tab.id === "number").sort((a, b) =>
    Number(Boolean(b.active)) - Number(Boolean(a.active))
    || Number(/chatgpt\.com\/c\//.test(b.url ?? "")) - Number(/chatgpt\.com\/c\//.test(a.url ?? ""))
    || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  )[0];
}

/** A missing receiver is recoverable: inject the manifest content script, then ping until it initializes. */
export async function ensureContentConnection(deps: ContentConnectionDeps): Promise<{ ok: boolean; injected: boolean; code?: "NO_CONTENT_SCRIPT" | "BRIDGE_INJECTION_FAILED" }> {
  if (await deps.ping()) return { ok: true, injected: false };
  try { await deps.inject(); }
  catch { return { ok: false, injected: false, code: "BRIDGE_INJECTION_FAILED" }; }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await deps.wait(120 + attempt * 80);
    if (await deps.ping()) return { ok: true, injected: true };
  }
  return { ok: false, injected: true, code: "NO_CONTENT_SCRIPT" };
}
