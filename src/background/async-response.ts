/** Bound each promised reply and keep only its active worker operation alive. */
export function respondAsync(sendResponse: (response: unknown) => void, operation: () => Promise<unknown>, timeoutMs = 150_000): true {
  let replied = false;
  const finish = (response: unknown) => {
    if (replied) return;
    replied = true; clearTimeout(deadline); clearInterval(activity);
    try { sendResponse(response); } catch { /* The requesting tab/panel may already have closed. */ }
  };
  // A pending Promise alone does not prevent the MV3 worker's idle shutdown.
  const activity = setInterval(() => {
    try { void chrome.runtime.getPlatformInfo?.().catch(() => undefined); } catch { /* Extension context was invalidated. */ }
  }, 20_000);
  const deadline = setTimeout(() => finish({ ok: false, code: "RESPONSE_TIMEOUT", error: "操作等待超时，已保存的内容保留。请核对当前对话后重试。" }), timeoutMs);
  const fail = (error: unknown) => finish({ ok: false, error: error instanceof Error ? error.message : "ChatAtlas 操作未完成，请重试。" });
  // Start immediately so queued commands capture the cancellation revision at receipt.
  try { void Promise.resolve(operation()).then(finish, fail); } catch (error) { fail(error); }
  return true;
}
