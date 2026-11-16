export const DOM_TOOL_TRAFFIC = '.toolcall-container,[data-tool-call-id],[data-message-type="tool"],[data-testid="tool-call"],[data-testid="tool-result"],[data-testid="tool_call"],[data-testid="tool_result"]';

/** Generated pictures may be inside an execution result. Keep the pictures, discard its process chrome. */
export function stripDomToolTraffic(copy: HTMLElement): void {
  for (const node of copy.querySelectorAll(DOM_TOOL_TRAFFIC)) {
    if (!copy.contains(node)) continue;
    node.replaceWith(...[...node.querySelectorAll("img")].map(image => image.cloneNode(true)));
  }
}
