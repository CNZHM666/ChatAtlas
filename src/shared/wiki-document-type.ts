/** What a document organizes: a project being planned and built, or what the user learned. One type per document; the
 * user's choice outranks the automatic one. */
export type WikiDocumentType = "project" | "learning";
/** The choice in the input area: auto lets the run decide from the material. */
export type WikiDocumentTypeChoice = "auto" | WikiDocumentType;

/** What a knowledge point is to a learner. goal: what the learning is for; concept: what something is or how it works;
 * example: a short code or worked example; exercise: what the user wrote or answered; mistake: an error and its fix;
 * learned / todo / skip: what is learned, still to learn, or left for now; check: a self-test or acceptance standard
 * from the conversation; method: how to study; resource: a course, video or document to use. */
export type LearningRole = "goal" | "concept" | "example" | "exercise" | "mistake" | "learned" | "todo" | "skip" | "check" | "method" | "resource";
export const LEARNING_ROLES: LearningRole[] = ["goal", "concept", "example", "exercise", "mistake", "learned", "todo", "skip", "check", "method", "resource"];

const CHOICE_KEY = "atlas-document-type";
/** The type chosen in the input area, kept for the next run. */
export function chosenDocumentType(): WikiDocumentTypeChoice {
  try { const value = localStorage.getItem(CHOICE_KEY); return value === "project" || value === "learning" ? value : "auto"; } catch { return "auto"; }
}
export function chooseDocumentType(choice: WikiDocumentTypeChoice): void {
  try { if (choice === "auto") localStorage.removeItem(CHOICE_KEY); else localStorage.setItem(CHOICE_KEY, choice); } catch { /* storage blocked: the choice lasts this page */ }
}

/** Learning documents are in beta: offered when the user picks them, never chosen automatically, and marked as a
 * beta wherever they are read or exported. */
export const LEARNING_BETA = true;
export const learningBetaNote = (zh: boolean) => zh ? "学习模式仍在测试中，排版和抽取规则会继续调整；遇到问题欢迎反馈。" : "Learning mode is in beta: its layout and extraction will keep changing. Feedback is welcome.";

/** A document's type: older documents and those with no type are projects. */
export const documentTypeOf = (ledger: { documentType?: WikiDocumentType } | undefined): WikiDocumentType => ledger?.documentType ?? "project";
export const documentTypeLabel = (type: WikiDocumentType, zh: boolean) => type === "learning" ? zh ? "学习" : "Learning" : zh ? "项目" : "Project";
