import { expect, it } from "vitest";
import { interactivePreviewDocument } from "./interactive-preview";
it("preserves self-contained local interaction while denying remote dependencies and navigation", async () => {
  const fsModule = "node:fs", { readFileSync } = await import(/* @vite-ignore */ fsModule);
  const html = interactivePreviewDocument('<div><button onclick="this.textContent=\'Done\'">Try</button><script>let local = 1</script><script src="https://example.test/app.js"></script><iframe src="https://example.test"></iframe><form action="https://example.test"><input></form><a target="_top" href="https://example.test">Exit</a></div>', "html")!;
  expect(html).toContain("onclick="); expect(html).toContain("let local = 1");
  expect(html).not.toContain("https://example.test");
  expect(html).toContain("connect-src 'none'"); expect(html).toContain("form-action 'none'");
  expect(interactivePreviewDocument("<div>Example</div>", "typescript")).toBeUndefined();
  const manifest = readFileSync("manifest.config.ts", "utf8");
  expect(manifest).toContain('sandbox: { pages: ["reader-preview.html"] }');
  expect(manifest).not.toContain("allow-same-origin");
  const bridge = readFileSync("reader-preview.html", "utf8");
  expect(bridge).toContain("event.source !== parent");
});
it("recovers declarative tabs/expanders and disables buttons whose original actions are missing", () => {
  const html = interactivePreviewDocument('<section><div role="tablist"><button role="tab" aria-controls="one">One</button><button role="tab" aria-controls="two">Two</button></div><div id="one">First</div><div id="two" hidden>Second</div><button aria-controls="detail" aria-expanded="false">Details</button><p id="detail" hidden>More</p><button>Unavailable server action</button></section>', "html")!;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  expect(parsed.querySelectorAll("button[data-atlas-local-target]")).toHaveLength(3);
  expect(parsed.querySelector("section > button:last-of-type")?.hasAttribute("disabled")).toBe(true);
});
