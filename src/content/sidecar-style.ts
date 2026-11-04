export const sidecarStyle = `
:host{position:fixed;z-index:2147483000;top:0;right:0;bottom:0;max-width:100vw;pointer-events:none;color-scheme:light;--bg:#fff;--fg:#202123;--muted:#51525c;--line:#ececee;--hover:#f5f5f5;--accent:#147a3a;font-family:inherit;font-size:16px;line-height:1.6}
:host(.dark){color-scheme:dark;--bg:#212121;--fg:#f2f2f2;--muted:#b9bbc5;--line:#303032;--hover:#303030;--accent:#4ade80}
*{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer}button:focus-visible,.resize:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.panel{position:relative;width:100%;height:100%;pointer-events:auto;background:var(--bg);color:var(--fg);border-left:1px solid var(--line);box-shadow:none;display:flex;flex-direction:column}
.head-top{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 20px;border-bottom:1px solid var(--line)}
.brand{border:0;background:transparent;padding:0;font-weight:650;font-size:22px}.close{border:0;background:transparent;border-radius:8px;width:32px;height:32px;color:var(--muted);padding:0;font-size:24px;line-height:1}.close:hover{background:var(--hover);color:var(--fg)}
.brand{display:flex;align-items:center;gap:8px}.brand img{display:block;width:32px;height:32px;object-fit:contain}
.project-frame{width:100%;min-height:0;flex:1;border:0;background:var(--bg)}
.resize{position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:ew-resize;z-index:2;touch-action:none}.resize:hover:after{content:"";position:absolute;left:3px;top:0;bottom:0;width:2px;background:var(--muted);opacity:.35}
.collapse{display:grid;place-items:center;border:0;background:transparent;color:var(--muted);border-radius:8px;width:30px;height:30px;padding:0}.collapse:hover{background:var(--hover);color:var(--fg)}
:host(.is-collapsed) .brand,:host(.is-collapsed) .resize{display:none}:host(.is-collapsed) .head-top{padding:14px 6px;border:0}:host(.is-collapsed) .panel{box-shadow:none}.project-frame[hidden]{display:none}
`;
