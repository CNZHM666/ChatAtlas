import { ReadingStageList } from "./ReadingStageList";

/** A small ordered explanation, not a general diagram language or executable SVG. */
export function ReadingFlow({ steps }: { steps: string[] }) {
  return <ReadingStageList>{steps.map((step, index) => <li key={index}>{step}</li>)}</ReadingStageList>;
}
