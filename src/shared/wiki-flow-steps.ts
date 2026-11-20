export const WIKI_FLOW_ARROW = /\s*(?:→|->|—>|=>|↓)\s*/u;

const brackets = new Map([["(", ")"], ["（", "）"], ["[", "]"], ["【", "】"], ["{", "}"], ["「", "」"], ["『", "』"]]);

export function wikiFlowSteps(text: string) {
  const steps: string[] = [], arrows: string[] = [];
  const closing: string[] = [];
  const arrowAt = new RegExp(WIKI_FLOW_ARROW.source, "uy");
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const close = brackets.get(character);
    if (close) closing.push(close);
    else if (character === closing.at(-1)) closing.pop();
    else if (!closing.length) {
      arrowAt.lastIndex = index;
      const match = arrowAt.exec(text);
      if (!match) continue;
      steps.push(text.slice(start, index));
      arrows.push(match[0]);
      start = arrowAt.lastIndex;
      index = start - 1;
    }
  }
  steps.push(text.slice(start));
  return { steps, arrows };
}
