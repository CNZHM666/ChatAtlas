import type {WikiTitleReview} from "./focus-session";

/** Editorial outcomes: the model kept the name, or proposed one that was still
 * paired or collided with a sibling. Retrying the same pass does not change them. */
const EDITORIAL=new Set(["unchanged","paired","kept_paired","collision","too_short"]);

/** Only a real processing failure (request failed, budget, invalid or missing
 * output) leaves titles "unfinished" and worth retrying. */
export function wikiTitleReviewIncomplete(review:WikiTitleReview|undefined):boolean {
 return Boolean(review&&["partial","failed"].includes(review.status)&&review.rejected.some(item=>!EDITORIAL.has(item.reason)));
}
