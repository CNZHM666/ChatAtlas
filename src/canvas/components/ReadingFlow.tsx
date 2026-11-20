import { ReadingStageList } from "./ReadingStageList";
import { Children, isValidElement, type ReactNode } from "react";

/** A small ordered explanation, not a general diagram language or executable SVG. */
export function ReadingFlow({ steps }: { steps: string[] }) {
  return <ReadingStageList>{steps.map((step, index) => <li key={index}>{step}</li>)}</ReadingStageList>;
}

export function WikiFlowCard({ children }: { children?: ReactNode }) {
  const [title, sources, steps] = Children.toArray(children).filter(child => typeof child !== "string" || child.trim());
  const sourceLinks = isValidElement<{ children?: ReactNode }>(sources) ? sources.props.children : undefined;
  return <figure className="wiki-flow">
    <figcaption>{title}{sourceLinks ? <span className="wiki-flow-sources">{sourceLinks}</span> : null}</figcaption>
    <div className="wiki-flow-card">{steps}</div>
  </figure>;
}
