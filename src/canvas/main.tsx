import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "katex/dist/katex.min.css";
import "./reader-code-theme.css";
import App from "./App";
import { PreferencesProvider } from "./preferences";
import { PanelBoundary } from "./components/PanelBoundary";
import {installUiFailureCapture} from "./ui-failure";
import {preferredTheme} from "../shared/appearance";
import { installBrandFavicon } from "../shared/brand-assets";
import "./styles.css";
import "./reader-media.css";
import "./reading-workspace.css";
import "./history-workbench.css";

document.documentElement.dataset.theme = preferredTheme();
installUiFailureCapture();
installBrandFavicon();
document.documentElement.lang = localStorage.getItem("atlas-locale") === "en" ? "en" : "zh-CN";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><PanelBoundary zh={document.documentElement.lang === "zh-CN"}><PreferencesProvider><App /></PreferencesProvider></PanelBoundary></React.StrictMode>,
);
// The page stayed up: a later stale file may reload it again.
window.setTimeout(() => { try { sessionStorage.removeItem("atlas-chunk-reload"); } catch { /* ignore */ } }, 15_000);
