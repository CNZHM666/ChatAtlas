import { defaultSchema } from "rehype-sanitize";

/** Keep the math markers until KaTeX runs; all other input uses the default policy. */
export const readerSanitizeSchema = {
  ...defaultSchema,
  // Presentation tags the Reader adds itself (reader-structure-presentation): no attributes, mapped to styled spans.
  tagNames:[...defaultSchema.tagNames??[],"mark","atlas-flow","atlas-flow-step","atlas-flow-arrow","atlas-lead","atlas-caption","atlas-caption-kind","atlas-caption-place","atlas-caption-ai","atlas-caption-mine","atlas-caption-old","atlas-caption-note"],
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []).filter(attribute => !Array.isArray(attribute) || attribute[0] !== "className"),
      ["className", /^language-./, "math-inline", "math-display"],
    ],
  },
};
