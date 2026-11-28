import { ReadingStageList } from "./ReadingStageList";
import { Children, isValidElement, type ReactNode } from "react";

const splitStep = (step: string) => {
  const match = /^([^：:\n]{2,18})\s*[：:]\s*(\S[\s\S]*)$/u.exec(step.trim());
  return match ? { title: match[1].trim(), detail: match[2].trim() } : undefined;
};

/** A small ordered explanation, not a general diagram language or executable SVG. */
export function ReadingFlow({ steps }: { steps: string[] }) {
  return (
    <ReadingStageList>
      {steps.map((step, index) => {
        const parts = splitStep(step);
        return (
          <li key={index}>
            {parts ? (
              <span className="reading-flow-step-body">
                <strong className="reading-flow-step-title">{parts.title}</strong>
                <span className="reading-flow-step-detail">{parts.detail}</span>
              </span>
            ) : step}
          </li>
        );
      })}
    </ReadingStageList>
  );
}

export function WikiFlowCard({ children }: { children?: ReactNode }) {
  const [title, sources, steps] = Children.toArray(children).filter(child => typeof child !== "string" || child.trim());
  const sourceLinks = isValidElement<{ children?: ReactNode }>(sources) ? sources.props.children : undefined;
  return <figure className="wiki-flow">
    <figcaption>{title}{sourceLinks ? <span className="wiki-flow-sources">{sourceLinks}</span> : null}</figcaption>
    <div className="wiki-flow-card">{steps}</div>
  </figure>;
}
