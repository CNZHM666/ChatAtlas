import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "../src/canvas/reader-code-theme.css";
import "../src/canvas/styles.css";
import "../src/canvas/reader-media.css";
import "../src/canvas/reading-workspace.css";
import "../src/canvas/project-outcome.css";
import "../src/canvas/workspace-source-panel.css";
import "../src/demo/demo.css";
import { installBrandFavicon } from "../src/shared/brand-assets";
import { DemoApp } from "../src/demo/DemoApp";

installBrandFavicon();
createRoot(document.getElementById("root")!).render(<DemoApp />);
