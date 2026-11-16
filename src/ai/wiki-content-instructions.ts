import { WIKI_CHAPTER_OVERVIEW_INSTRUCTIONS } from "./wiki-chapter-overview-instructions";
import { WIKI_QUALITY_INSTRUCTIONS } from "./wiki-quality-instructions";

export const WIKI_CONTENT_REWRITE_INSTRUCTIONS = WIKI_QUALITY_INSTRUCTIONS + WIKI_CHAPTER_OVERVIEW_INSTRUCTIONS + `
Content edition v3. Follow the assigned ## topics. Preserve literal source conditions and every distinct supported detail in the requested scope. Use established names, substantive headings and sparse emphasis. Keep source prompts, internal IDs, scoring, extraction records and batch commentary out of prose. Bind complete assertions to literal evidence in claims.
Tag a few existing claims with complementary overview roles. Purpose gives the stable audience, problem and outcome. Workflow gives the core path. Scope gives the evidenced boundary. Use actual reports for progress and identify their source. Preserve qualifiers in prose and metadata.`;
