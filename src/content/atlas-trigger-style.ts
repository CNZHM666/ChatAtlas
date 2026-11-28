/** Platform-adapted companion trigger aligned with each host AI's native top bar or a clean floating pill fallback. */
export const ATLAS_TRIGGER_STYLE = `
.atlas-navigator-trigger {
  box-sizing: border-box;
  display: inline-flex;
  flex: 0 0 auto;
  align-self: center;
  align-items: center;
  justify-content: center;
  gap: 6px;
  vertical-align: middle;
  width: var(--atlas-trigger-size, 34px);
  height: var(--atlas-trigger-size, 34px);
  margin: 0 4px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--atlas-trigger-radius, 9px);
  color: CanvasText;
  background: transparent;
  line-height: 1;
  pointer-events: auto;
  touch-action: manipulation;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 120ms ease;
}
.atlas-navigator-trigger:active {
  transform: scale(0.95);
}
.atlas-trigger-mark {
  display: block;
  width: var(--atlas-trigger-icon, 20px);
  height: var(--atlas-trigger-icon, 20px);
  flex: none;
}
.atlas-trigger-mark img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.atlas-trigger-label {
  display: none;
  font: 600 12.5px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.atlas-navigator-trigger--toolbar {
  margin: 0 4px;
}
.atlas-navigator-trigger--edge {
  position: fixed;
  top: max(9px, env(safe-area-inset-top));
  right: calc(56px + env(safe-area-inset-right));
  z-index: 2147482000;
  margin: 0;
  width: var(--atlas-trigger-size, 36px);
  height: var(--atlas-trigger-size, 36px);
  border-radius: var(--atlas-trigger-radius, 999px);
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(15, 23, 42, 0.11);
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.05);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.atlas-navigator-trigger--edge[data-atlas-theme="dark"] {
  background: rgba(28, 30, 34, 0.86);
  border-color: rgba(255, 255, 255, 0.14);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.34), 0 1px 2px rgba(0, 0, 0, 0.24);
}
.atlas-navigator-trigger--edge:not(.is-anchor-aligned):hover {
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.13), 0 1px 3px rgba(15, 23, 42, 0.06);
  border-color: rgba(15, 23, 42, 0.18);
  transform: translateY(-0.5px);
}
.atlas-navigator-trigger--edge[data-atlas-theme="dark"]:not(.is-anchor-aligned):hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.44);
  border-color: rgba(255, 255, 255, 0.24);
}
.atlas-navigator-trigger--edge.is-anchor-aligned {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* Per-platform native visual adaptation */
.atlas-navigator-trigger[data-atlas-platform="chatgpt"] {
  --atlas-trigger-hover: rgba(0, 0, 0, 0.06);
  --atlas-trigger-radius: 10px;
}
.atlas-navigator-trigger[data-atlas-platform="chatgpt"][data-atlas-theme="dark"] {
  --atlas-trigger-hover: rgba(255, 255, 255, 0.10);
}
.atlas-navigator-trigger[data-atlas-platform="claude"] {
  --atlas-trigger-hover: rgba(61, 57, 41, 0.08);
  --atlas-trigger-radius: 8px;
}
.atlas-navigator-trigger[data-atlas-platform="claude"].atlas-navigator-trigger--edge:not(.is-anchor-aligned) {
  background: rgba(250, 249, 245, 0.92);
  border-color: rgba(61, 57, 41, 0.14);
}
.atlas-navigator-trigger[data-atlas-platform="claude"][data-atlas-theme="dark"] {
  --atlas-trigger-hover: rgba(255, 255, 255, 0.09);
}
.atlas-navigator-trigger[data-atlas-platform="claude"][data-atlas-theme="dark"].atlas-navigator-trigger--edge:not(.is-anchor-aligned) {
  background: rgba(38, 38, 36, 0.92);
  border-color: rgba(255, 255, 255, 0.14);
}
.atlas-navigator-trigger[data-atlas-platform="gemini"] {
  --atlas-trigger-hover: rgba(60, 64, 67, 0.09);
  --atlas-trigger-radius: 999px;
}
.atlas-navigator-trigger--edge:not(.is-anchor-aligned)[data-atlas-platform="gemini"] {
  top: max(12px, env(safe-area-inset-top));
  right: calc(72px + env(safe-area-inset-right));
}
.atlas-navigator-trigger[data-atlas-platform="gemini"][data-atlas-theme="dark"] {
  --atlas-trigger-hover: rgba(232, 234, 237, 0.11);
}
.atlas-navigator-trigger[data-atlas-platform="deepseek"] {
  --atlas-trigger-hover: rgba(77, 107, 254, 0.10);
  --atlas-trigger-radius: 10px;
}
.atlas-navigator-trigger--edge:not(.is-anchor-aligned)[data-atlas-platform="deepseek"] {
  top: max(14px, env(safe-area-inset-top));
  right: calc(56px + env(safe-area-inset-right));
}
.atlas-navigator-trigger[data-atlas-platform="deepseek"][data-atlas-theme="dark"] {
  --atlas-trigger-hover: rgba(120, 145, 255, 0.16);
}
.atlas-navigator-trigger[data-atlas-platform="doubao"] {
  --atlas-trigger-hover: rgba(0, 0, 0, 0.06);
  --atlas-trigger-radius: 999px;
}
.atlas-navigator-trigger--edge:not(.is-anchor-aligned)[data-atlas-platform="doubao"] {
  top: max(12px, env(safe-area-inset-top));
  right: calc(64px + env(safe-area-inset-right));
}
.atlas-navigator-trigger[data-atlas-platform="doubao"][data-atlas-theme="dark"] {
  --atlas-trigger-hover: rgba(255, 255, 255, 0.10);
}
.atlas-navigator-trigger[data-atlas-platform="kimi"] {
  --atlas-trigger-hover: rgba(15, 23, 42, 0.07);
  --atlas-trigger-radius: 10px;
}
.atlas-navigator-trigger--edge:not(.is-anchor-aligned)[data-atlas-platform="kimi"] {
  top: max(12px, env(safe-area-inset-top));
  right: calc(60px + env(safe-area-inset-right));
}
.atlas-navigator-trigger[data-atlas-platform="kimi"][data-atlas-theme="dark"] {
  --atlas-trigger-hover: rgba(255, 255, 255, 0.10);
}
.atlas-navigator-trigger[data-atlas-platform="qwen"] {
  --atlas-trigger-hover: rgba(97, 92, 237, 0.10);
  --atlas-trigger-radius: 10px;
}
.atlas-navigator-trigger--edge:not(.is-anchor-aligned)[data-atlas-platform="qwen"] {
  top: max(12px, env(safe-area-inset-top));
  right: calc(64px + env(safe-area-inset-right));
}
.atlas-navigator-trigger[data-atlas-platform="qwen"][data-atlas-theme="dark"] {
  --atlas-trigger-hover: rgba(140, 136, 255, 0.16);
}

.atlas-navigator-trigger--toolbar:hover,
.atlas-navigator-trigger--edge.is-anchor-aligned:hover {
  background: var(--atlas-trigger-hover, rgba(128, 128, 128, 0.11));
}
.atlas-navigator-trigger:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}
.atlas-trigger-status {
  position: fixed;
  top: 56px;
  right: max(12px, env(safe-area-inset-right));
  z-index: 2147482001;
  max-width: min(320px, calc(100vw - 24px));
  padding: 9px 13px;
  border: 1px solid rgba(128, 128, 128, 0.28);
  border-radius: 10px;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  font: 13px/1.5 system-ui, -apple-system, sans-serif;
}
`;
