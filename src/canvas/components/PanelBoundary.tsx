import { Component, type ReactNode } from "react";

const RELOADED_KEY = "atlas-chunk-reload";

/** A code file the page asks for no longer exists: the extension was rebuilt while this tab stayed open. */
export const staleChunk = (error: unknown) => /dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk|Unable to preload CSS/iu.test(error instanceof Error ? `${error.name} ${error.message}` : String(error));

/** Keeps one failing part from blanking the whole page. With no boundary, a panel whose code could not load (opening
 * settings from the model picker after a rebuild) or that threw while rendering left a white screen. A stale file
 * reloads the page once; anything else shows the error, with a reload and, for a panel, a close. */
export class PanelBoundary extends Component<{ zh: boolean; onClose?: () => void; children: ReactNode }, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown) {
    if (!staleChunk(error)) return;
    let reloaded = false;
    try { reloaded = sessionStorage.getItem(RELOADED_KEY) !== null; sessionStorage.setItem(RELOADED_KEY, "1"); } catch { /* storage blocked: show the message instead */ reloaded = true; }
    if (!reloaded) location.reload();
  }
  render() {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    const { zh, onClose } = this.props;
    const stale = staleChunk(error);
    const detail = error instanceof Error ? error.message : String(error);
    return <div role="alert" className="panel-boundary">
      <strong>{stale ? zh ? "ChatAtlas 已更新，请重新加载页面" : "ChatAtlas was updated. Reload the page." : zh ? "这部分界面出错了" : "This part of the page failed"}</strong>
      {stale ? null : <small>{detail}</small>}
      <div>
        <button type="button" className="import-button primary" onClick={() => { try { sessionStorage.removeItem(RELOADED_KEY); } catch { /* ignore */ } location.reload(); }}>{zh ? "重新加载" : "Reload"}</button>
        {onClose ? <button type="button" className="import-button" onClick={() => { this.setState({ error: undefined }); onClose(); }}>{zh ? "关闭" : "Close"}</button> : null}
      </div>
    </div>;
  }
}
