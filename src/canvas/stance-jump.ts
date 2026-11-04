import { stanceKey } from "../shared/wiki-chapter-status";

/** Scrolls to the rendered paragraph that holds a sentence of the chapter's prose and marks it for a moment.
 * The sentence is matched by its first characters with punctuation and Markdown removed, as the reader shows it. */
export function jumpToSentence(root: HTMLElement | null, sentence: string): boolean {
  const probe = stanceKey(sentence.replace(/\*\*|__|`/gu, "")).slice(0, 16);
  if (!root || probe.length < 4) return false;
  const found = [...root.querySelectorAll<HTMLElement>("p, li, td, blockquote")].find(node => stanceKey(node.textContent ?? "").includes(probe));
  if (!found) return false;
  found.scrollIntoView?.({ block: "center", behavior: "smooth" });
  found.classList.remove("is-stance-target"); void found.offsetWidth; found.classList.add("is-stance-target");
  window.setTimeout(() => found.classList.remove("is-stance-target"), 2600);
  return true;
}
