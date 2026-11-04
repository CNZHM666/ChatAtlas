export type NavigationPlacement = "question-top" | "question-answer-boundary" | "message-context";

export interface NavigationGeometry {
  role: "user" | "assistant";
  messageTop: number;
  messageBottom: number;
  answerTop?: number;
  textLength: number;
  viewportTop: number;
  viewportHeight: number;
  headerBottom: number;
  preferQuestionTop?: boolean;
}

/** All coordinates are viewport-relative; the returned delta applies to either window or a nested scroll container. */
export function calculateNavigationPlacement(geometry: NavigationGeometry): { placement: NavigationPlacement; scrollDelta: number } {
  const longQuestion = geometry.role === "user" && !geometry.preferQuestionTop && (geometry.messageBottom - geometry.messageTop > geometry.viewportHeight * .3 || geometry.textLength > 480);
  const placement: NavigationPlacement = geometry.role === "assistant" ? "message-context" : longQuestion ? "question-answer-boundary" : "question-top";
  const fraction = placement === "question-answer-boundary" ? .27 : placement === "message-context" ? .22 : .19;
  const idealTop = geometry.viewportTop + geometry.viewportHeight * fraction;
  const targetTop = Math.max(idealTop, geometry.headerBottom + 16);
  const point = placement === "question-answer-boundary" ? geometry.answerTop ?? geometry.messageBottom : geometry.messageTop;
  return { placement, scrollDelta: Math.round(point - targetTop) };
}
