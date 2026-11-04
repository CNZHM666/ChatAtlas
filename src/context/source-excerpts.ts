import {discussionBlocks} from "../shared/discussion-context";
import type {ContextSource} from "./types";

/** A related reference is not claim-level proof. Never slice through a paragraph or code. */
export function relatedSourceExcerpt(source:ContextSource):string|undefined {
  const excerpt=source.excerpts?.find(text=>text.trim());
  return excerpt?discussionBlocks(excerpt,Infinity).find(block=>block.text.trim().length<=240&&!/(?:^|\n)\s*(?:```|~~~)/u.test(block.text))?.text.trim():undefined;
}
