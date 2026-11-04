/** GFM as the reader reads it: tables, task lists and ~~strikethrough~~, but never a single tilde as strikethrough. A
 * range written "760~800px，min-height 110~130px" struck out everything between its two tildes in the Wiki. */
export const GFM_OPTIONS = { singleTilde: false } as const;
