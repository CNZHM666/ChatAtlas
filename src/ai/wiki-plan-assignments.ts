import type { FocusSection } from "../shared/focus-session";
import { wikiOutlineError } from "./wiki-outline-policy";

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Routing labels have no semantic meaning. Normalize transport spelling only;
 * never guess a missing destination or choose between colliding labels. */
function routingKey(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value !== "string") return;
  const key = value.trim();
  return key && key.length <= 120 && !/\p{Cc}/u.test(key) ? key : undefined;
}

function topicKey(topic: Row, path: string): string {
  // Some providers spell this field id/topicId. Only accept explicit, mutually
  // agreeing identities; a present but invalid key cannot borrow another field.
  const supplied = Object.hasOwn(topic, "key") ? [topic.key]
    : ["id", "topicId"].filter(field => Object.hasOwn(topic, field)).map(field => topic[field]);
  const keys = supplied.map(routingKey), key = keys[0];
  if (!key || keys.some(candidate => candidate !== key)) {
    const error = wikiOutlineError("topic_key", path);
    error.wikiDirectoryIssues = [{ path, reason: "required_text", maxLength: 120 }];
    throw error;
  }
  return key;
}

/** A material has one explicit destination. Never choose among competing owners. */
export function expandWikiAssignments(value: unknown, sections: FocusSection[]): unknown {
  if (!isRow(value) || !Object.hasOwn(value, "assignments")) return value;
  if (!Array.isArray(value.pages)) throw wikiOutlineError("pages");
  // Empty legacy metadata carries no competing ownership. The canonical leaf
  // lists still pass the full coverage and conflict validator below this layer.
  if (value.assignments == null || Array.isArray(value.assignments) && !value.assignments.length || isRow(value.assignments) && !Object.keys(value.assignments).length) {
    const leaves = value.pages.flatMap(page => isRow(page) && Array.isArray(page.subtopics) ? page.subtopics : []);
    if (leaves.length && leaves.every(topic => isRow(topic) && Array.isArray(topic.sectionIds))) return { ...value, assignments: undefined, pages: value.pages };
  }
  if (!isRow(value.assignments)) throw wikiOutlineError("assignment_format", "assignments");
  const assignments = value.assignments, known = new Set(sections.map(section => section.id));
  const topics = new Set<string>();
  const inventory = value.pages.map((page: unknown, index: number) => {
    if (!isRow(page) || !Array.isArray(page.subtopics) || !page.subtopics.length) throw wikiOutlineError("hierarchy_missing", `pages[${index}].subtopics`);
    const subtopics = page.subtopics.map((topic: unknown, child: number): Row & {key: string} => {
      const path = `pages[${index}].subtopics[${child}].key`;
      if (!isRow(topic)) throw wikiOutlineError("topic_key", path);
      const key = topicKey(topic, path);
      if (topics.has(key)) throw wikiOutlineError("duplicate_topic_key", path);
      topics.add(key);
      return { ...topic, key };
    });
    return { page, subtopics };
  });
  const missingIds = sections.filter(section => !Object.hasOwn(assignments, section.id)).map(section => section.id);
  const unknownIds = Object.keys(assignments).filter(id => !known.has(id)).map((id, index) => /^m\d{1,5}$/u.test(id) ? id : `invalid-${index}`).slice(0, 36);
  const invalidAssignmentIds = sections.filter(section => Object.hasOwn(assignments, section.id) && !topics.has(routingKey(assignments[section.id]) ?? "")).map(section => section.id);
  if (missingIds.length || unknownIds.length || invalidAssignmentIds.length) {
    const error = wikiOutlineError(unknownIds.length ? "assignment_identity" : invalidAssignmentIds.length ? "assignment_target" : "coverage", "assignments");
    error.fieldPaths = [...missingIds, ...invalidAssignmentIds].slice(0, 8).map(id => /^m\d{1,5}$/u.test(id) ? `assignments.${id}` : "assignments");
    if (!error.fieldPaths.length) error.fieldPaths = ["assignments"];
    error.wikiDirectoryDetails = { missingIds, duplicateIds: [], unknownIds, parentMismatchIds: [], ...(invalidAssignmentIds.length ? { invalidAssignmentIds } : {}) };
    throw error;
  }
  const checkRedundant = (provided: unknown, expected: string[], path: string) => {
    if (provided === undefined) return;
    if (!Array.isArray(provided) || provided.some(id => typeof id !== "string" || !expected.includes(id)) || expected.some(id => !provided.includes(id))) throw wikiOutlineError("assignment_conflict", path);
  };
  return { pages: inventory.map(({ page, subtopics }, index) => {
    const children = subtopics.map((topic, child) => {
      const sectionIds = sections.filter(section => routingKey(assignments[section.id]) === topic.key).map(section => section.id);
      checkRedundant(topic.sectionIds, sectionIds, `pages[${index}].subtopics[${child}].sectionIds`);
      return { title: topic.title, question: topic.question, sectionIds };
    });
    const owned = new Set(children.flatMap(topic => topic.sectionIds));
    const sectionIds = sections.filter(section => owned.has(section.id)).map(section => section.id);
    checkRedundant(page.sectionIds, sectionIds, `pages[${index}].sectionIds`);
    return { title: page.title, group: page.group, question: page.question, sectionIds, subtopics: children };
  }) };
}
