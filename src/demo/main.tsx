import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "../canvas/reader-code-theme.css";
import "../canvas/styles.css";
import "../canvas/reader-media.css";
import "../canvas/reading-workspace.css";
import "../canvas/project-outcome.css";
import "../canvas/workspace-source-panel.css";
import "./demo.css";
import { installBrandFavicon } from "../shared/brand-assets";
import { DemoApp } from "./DemoApp";

installBrandFavicon();
createRoot(document.getElementById("root")!).render(<DemoApp />);
