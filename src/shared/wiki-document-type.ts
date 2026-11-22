/** What a document organizes: a project being planned and built, or what the user learned. One type per document; the
 * user's choice outranks the automatic one. */
export type WikiDocumentType = "project" | "learning";

/** What a knowledge point is to a learner. goal: what the learning is for; concept: what something is or how it works;
 * example: a short code or worked example; exercise: what the user wrote or answered; mistake: an error and its fix;
 * learned / todo / skip: what is learned, still to learn, or left for now; check: a self-test or acceptance standard
 * from the conversation; method: how to study; resource: a course, video or document to use. */
export type LearningRole = "goal" | "concept" | "example" | "exercise" | "mistake" | "learned" | "todo" | "skip" | "check" | "method" | "resource";
export const LEARNING_ROLES: LearningRole[] = ["goal", "concept", "example", "exercise", "mistake", "learned", "todo", "skip", "check", "method", "resource"];

/** Label preserved for exports of saved learning documents. */
export const LEARNING_BETA = true;

/** A document's type: older documents and those with no type are projects. */
export const documentTypeOf = (ledger: { documentType?: WikiDocumentType } | undefined): WikiDocumentType => ledger?.documentType ?? "project";
export const documentTypeLabel = (type: WikiDocumentType, zh: boolean) => type === "learning" ? zh ? "学习" : "Learning" : zh ? "项目" : "Project";
