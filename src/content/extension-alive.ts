/** False once the extension was reloaded or updated under this page: the old script's calls then throw
 * "Extension context invalidated". */
export function extensionAlive(): boolean {
  try { return typeof chrome.runtime?.getURL !== "function" || Boolean(chrome.runtime.getURL("")); }
  catch { return false; }
}
