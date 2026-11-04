/** Every bounded automatic retry in Wiki organization, in one place. Token limits
 * count requested output ceilings (what a retry may cost at most), not billed
 * usage; writing recovery settles each ceiling to the provider-reported output
 * once the request ends. Changing a value changes behavior for every caller; the user-facing
 * messages and the AI workflow document quote these same numbers. */
export const RECOVERY_POLICY = {
  writing: {
    /** Recovery calls for one original writing batch, including its split children. */
    batchAttempts: 4,
    batchOutputTokens: 24_000,
    /** All writing recovery in one run. */
    stageOutputTokens: 48_000,
    stageRequests: (batches: number) => Math.max(6, Math.min(32, batches * 2)),
  },
  directory: {
    /** Metadata correction plus ownership continuation, per catalogue window. */
    windowAttempts: 4,
    windowOutputTokens: 24_000,
    /** Across all local windows, and separately for the global reconciliation. */
    localRepairs: 30,
    globalRepairs: 4,
    poolOutputTokens: 24_000,
    /** Retrying a truncated directory response with a larger output limit, or
     * re-planning a batch in halves after a repeated failure. One split costs
     * two requests; a 22-batch project needs room for a few of each. */
    truncationAttempts: 8,
    truncationOutputTokens: 30_000,
    /** Global convergence of parent chapters. */
    convergenceRounds: 4,
    convergenceRequests: 7,
    convergenceOutputTokens: 24_000,
    /** A windowed round needs one request per window plus a global pass and
     * a few truncation recoveries; scaled like writing batches, hard-capped. */
    windowedConvergenceRequests: (windows: number) => Math.max(7, Math.min(32, windows * 2 + 3)),
    windowedConvergenceOutputTokens: (windows: number) => Math.max(24_000, Math.min(96_000, (windows * 2 + 3) * 3_200)),
  },
} as const;
