import type { NativeImportSource, NativeReply, NativeRequest } from "../shared/native-import";
import { webCaptureSite } from "../shared/web-capture";
import { nativeImportSources } from "../shared/native-import-sources";

/** The tab to read through: the one the source was detected in, else another open tab of the same AI and account slot.
 * A source remembers the tab it was first found in; once that tab closes or leaves the site, every conversation of a
 * later sync failed with Chrome's "No tab with id", though the AI was open in another tab. */
async function sourceTab(source: NativeImportSource): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(source.tabId).catch(() => undefined);
  if (tab?.url && new URL(tab.url).origin === source.origin) return tab;
  const other = nativeImportSources(await chrome.tabs.query({})).find(item => item.id === source.id || item.origin === source.origin && item.platform === source.platform && !item.id.startsWith(`${source.origin}:`));
  if (!other) throw Error(`请先在浏览器中打开 ${source.label} 并保持登录，然后重试 / Open ${source.label}, stay signed in, and retry`);
  source.tabId = other.tabId;
  return chrome.tabs.get(other.tabId);
}

/** Runs read-only requests inside the selected site's session. Credentials never
 * cross the scripting boundary or enter IndexedDB, logs, or model requests. */
export async function nativeHistoryRequest(source: NativeImportSource, request: NativeRequest): Promise<NativeReply> {
  const tab = await sourceTab(source);
  const address = new URL(tab.url ?? "about:blank");
  if (address.origin !== source.origin || (source.platform === "chatgpt" ? address.origin !== "https://chatgpt.com" : webCaptureSite(address.href)?.id !== source.platform)) throw Error("来源网页已变化，请重新检测 AI / Source page changed; detect AI again.");
  const result = await chrome.scripting.executeScript({
    target: { tabId: source.tabId }, world: "MAIN",
    func: async (input: NativeImportSource, req: NativeRequest): Promise<{ reply?: NativeReply; error?: string }> => {
      try {
        if (location.origin !== input.origin) throw Error("Source page changed");
        const allowed: Record<string, RegExp> = {
          chatgpt: /^\/(?:api\/auth\/session|backend-api\/conversations|backend-api\/conversation\/[\w-]+)(?:\?|$)/u,
          claude: /^\/api\/organizations(?:\/[\w-]+\/(?:chat_conversations(?:\/[\w-]+)?|projects(?:\/[\w-]+\/conversations)?))?(?:\?|$)/u,
          deepseek: /^\/api\/v0\/(?:chat_session\/fetch_page|chat\/history_messages)(?:\?|$)/u,
          kimi: /^\/(?:api\/chat(?:\/list|\/[\w-]+(?:\/messages|\/segment\/scroll)?)|apiv2\/kimi\.gateway\.(?:feed\.v1\.FeedService\/ListFeeds|chat\.v1\.ChatService\/(?:GetChat|ListMessages)))(?:\?|$)/u,
          qwen: /^\/(?:api\/v[12]\/(?:chats\/(?:[\w-]+)?|session\/(?:page\/list|get|msg\/list|req\/list|req\/detail|group\/list)))(?:\?|$)/u,
          doubao: /^\/im\/(?:chain\/(?:recent_conv|single)|conversation\/info)(?:\?|$)/u,
          gemini: /^\/app(?:\?|$)/u,
        };
        if (!allowed[input.platform]?.test(req.path) || req.path.includes("..") || req.path.startsWith("//")) throw Error("History request is not allowed");
        const globals = window as Window & { WIZ_global_data?: Record<string, unknown> };
        const cookie = (name: string) => document.cookie.split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
        const sessionSnapshot = () => JSON.stringify([
          ...["userToken", "access_token", "kimi-auth", "token", "flow_tea_user_id"].map(key => localStorage.getItem(key)),
          ...["lastActiveOrg", "uid_tt", "sid_guard", "b-user-id", "tongyi_sso_ticket"].map(cookie),
          globals.WIZ_global_data?.oPEP7c, globals.WIZ_global_data?.XWmO9e,
        ]);
        const beforeSession = sessionSnapshot();
        let token = "", identity = "";
        for (const key of input.platform === "deepseek" ? ["userToken"] : input.platform === "kimi" ? ["access_token", "kimi-auth"] : input.platform === "qwen" ? ["token", "access_token"] : []) {
          const value = localStorage.getItem(key) || cookie(key);
          if (!value) continue;
          try { const parsed = JSON.parse(value); token = typeof parsed === "string" ? parsed : parsed.value ?? parsed.access_token ?? parsed.token ?? ""; } catch { token = value; }
          if (token) break;
        }
        let sessionToken = "";
        if (input.platform === "chatgpt") {
          const session = await fetch("/api/auth/session", { credentials: "include", signal: AbortSignal.timeout(15000) }).then(r => r.json());
          sessionToken = session.accessToken ?? ""; identity = session.user?.id ?? "";
          if (!sessionToken || !identity) throw Error("请先登录 ChatGPT / Sign in to ChatGPT");
        }
        if (input.platform === "claude") identity = cookie("lastActiveOrg") ?? "";
        if (input.platform === "gemini") identity = String(globals.WIZ_global_data?.oPEP7c ?? globals.WIZ_global_data?.XWmO9e ?? "");
        if (input.platform === "doubao") identity = cookie("uid_tt") ?? localStorage.getItem("flow_tea_user_id") ?? cookie("sid_guard") ?? "";
        if (input.platform === "qwen") identity = cookie("b-user-id") ?? cookie("tongyi_sso_ticket") ?? "";
        if (token && !identity) {
          try {
            const payload = JSON.parse(atob(token.split(".")[1].replace(/-/gu, "+").replace(/_/gu, "/")));
            identity = String(payload.sub ?? payload.user_id ?? payload.uid ?? "");
          } catch { /* Opaque tokens bind this import to the current login session. */ }
        }
        identity ||= token;
        // Hash locally: even opaque session identifiers are never returned raw.
        if (!identity) throw Error("无法确认登录账号，请打开并登录该 AI 后重试 / Cannot verify account; sign in and retry");
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
        const account = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
        if (input.account && input.account !== account) throw Error("登录账号已变化，请重新导入，已保存内容保留 / Account changed; start a new import");
        const headers: Record<string, string> = { Accept: "application/json" };
        if (token || sessionToken) headers.Authorization = `Bearer ${sessionToken || token}`;
        let url = new URL(req.path, input.origin), body: string | undefined;
        if (req.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(req.body); }
        if (input.platform === "qwen" && input.origin === "https://www.qianwen.com") {
          url = new URL(req.path, "https://chat2-api.qianwen.com");
          headers["x-platform"] = "pc_tongyi";
          const xsrf = cookie("XSRF-TOKEN") ?? cookie("X-XSRF-TOKEN");
          if (xsrf) headers["x-xsrf-token"] = decodeURIComponent(xsrf);
          for (const [key, value] of Object.entries({ biz_id: "ai_qwen", chat_client: "h5", device: "pc", fr: "pc", pr: "qwen", ut: cookie("b-user-id") ?? "", la: "zh-CN", tz: "Asia/Shanghai", ve: "4.0.7", wv: "4.0.7" })) url.searchParams.set(key, value);
        }
        if (input.platform === "doubao") {
          headers["agw-js-conv"] = "str";
          headers["Content-Type"] = "application/json; encoding=utf-8";
          // The IM request requires numeric cursor tokens, even though responses
          // encode int64 values as strings. Emit exact digits without Number rounding.
          if (body) body = body.replace(/"(conv_version|anchor_index)":"(0|[1-9]\d*)"/gu, '"$1":$2');
          // Reuse this site's own device/version parameters, without exporting them.
          const observed = performance.getEntriesByType("resource").map(entry => entry.name).reverse().find(value => { try { const address = new URL(value); return address.origin === input.origin && /^\/im\//u.test(address.pathname); } catch { return false; } });
          if (observed) url.search = new URL(observed).search;
          else for (const [key, value] of Object.entries({ version_code: "20800", language: "zh", device_platform: "web", aid: "497858", real_aid: "497858", pkg_type: "release_version", region: "CN", sys_region: "CN", samantha_web: "1", web_platform: "browser", "use-olympus-account": "1", device_id: localStorage.getItem("desktop_device_id") ?? "", web_id: localStorage.getItem("flow_tea_user_id") ?? "" })) url.searchParams.set(key, value);
        }
        if (req.rpc) {
          const wiz = globals.WIZ_global_data;
          if (input.platform !== "gemini" || !wiz?.SNlM0e || !wiz.cfb2h) throw Error("Gemini session format changed; reload the page");
          url = new URL("/_/BardChatUi/data/batchexecute", input.origin);
          for (const [key, value] of Object.entries({ rpcids: req.rpc, bl: String(wiz.cfb2h), "f.sid": String(wiz.FdrFJe ?? ""), "source-path": location.pathname, rt: "c", authuser: new URL(location.href).searchParams.get("authuser") ?? /^\/u\/(\d+)\//u.exec(location.pathname)?.[1] ?? "0" })) url.searchParams.set(key, value);
          headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
          body = new URLSearchParams({ at: String(wiz.SNlM0e), "f.req": JSON.stringify([[[req.rpc, JSON.stringify(req.body), null, "generic"]]]) }).toString();
        }
        const response = await fetch(url.href, { method: body === undefined ? "GET" : "POST", credentials: "include", headers, body, signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw Error(`历史读取失败 / History request failed (${response.status})`);
        if (response.redirected && new URL(response.url).origin !== url.origin) throw Error("登录已失效 / Session expired (401)");
        let data: unknown;
        if (req.rpc) {
          const text = await response.text();
          for (const line of text.split("\n")) {
            try { const rows: unknown = JSON.parse(line); if (!Array.isArray(rows)) continue;
              const row = rows.find(v => Array.isArray(v) && v[0] === "wrb.fr" && v[1] === req.rpc);
              if (row && typeof row[2] === "string") { data = JSON.parse(row[2]); break; }
            } catch { /* Framing lines contain byte lengths, not JSON payloads. */ }
          }
          if (data === undefined) throw Error("Gemini history response format changed");
        } else data = await response.json();
        if (location.origin !== input.origin) throw Error("Source page changed during import");
        if (sessionSnapshot() !== beforeSession) throw Error("读取期间登录账号或会话已变化，请重试 / Account or session changed during import");
        return { reply: { data, account } };
      } catch (error) { return { error: error instanceof Error ? error.message : "History request failed" }; }
    }, args: [source, request],
  });
  const value = result[0]?.result;
  if (!value?.reply) throw Error(value?.error ?? "无法连接 AI 页面，请刷新后重试 / Reload the AI page and retry");
  const fresh = await chrome.tabs.get(source.tabId);
  if (fresh.url !== tab.url) throw Error("读取期间来源网页已变化 / Source page changed during import");
  if (source.account && source.account !== value.reply.account) throw Error("Account changed");
  source.account = value.reply.account;
  return value.reply;
}
