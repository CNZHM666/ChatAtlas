import { defineManifest } from "@crxjs/vite-plugin";
import { allWebCapturePatterns } from "./src/shared/web-capture";

export function createManifest(_apiBaseUrl = "") {
  void _apiBaseUrl; // A previous build URL must not restore hosted access.
  return defineManifest({
  manifest_version: 3,
  name: "ChatAtlas",
  short_name: "ChatAtlas",
  version: "0.1.3",
  description: "Review past AI conversations in context and build a personal knowledge reading path.",
  icons: {
    16: "src/assets/brand/icon-16.png",
    32: "src/assets/brand/icon-32.png",
    48: "src/assets/brand/icon-48.png",
    128: "src/assets/brand/icon-128.png",
  },
  permissions: ["storage", "tabs", "alarms", "scripting", "sidePanel"],
  host_permissions: ["https://chatgpt.com/*",...allWebCapturePatterns()],
  optional_host_permissions: ["https://*/*", "http://*/*"],
  side_panel: { default_path: "sidecar.html?native=1" },
  action: {
    default_title: "Open ChatAtlas",
    default_icon: {
      16: "src/assets/brand/icon-16.png",
      32: "src/assets/brand/icon-32.png",
      48: "src/assets/brand/icon-48.png",
    },
  },
  commands: {
    _execute_action: { suggested_key: { default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" }, description: "Open ChatAtlas sidebar on a supported AI page" },
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://chatgpt.com/*"],
      js: ["src/content/chatgpt-content.ts"],
      run_at: "document_idle",
    },
  ],
  // Only the side panel is framed inside a web page (ChatGPT's native navigator). The workspace (atlas.html) is opened by
  // the extension itself, so no website may load it: listing it for <all_urls> let any page frame or probe it.
  web_accessible_resources: [
    {
      resources: ["sidecar.html"],
      matches: ["https://chatgpt.com/*"],
    },
  ],
  });
}

export default createManifest();
