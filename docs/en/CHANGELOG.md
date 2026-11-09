# Changelog

- Repair eligible Wiki claim quote/citation fields before source splitting, retaining article prose under existing recovery limits. Export exact field paths/reasons and resume interrupted metadata repairs.

- Sequence Wiki organization by stage while retaining catalogue identities, legacy checkpoints and request compatibility. Add failure provenance, offline fixed-sample benchmarks and developer CSV comparisons; pre-send local stops do not count as sent requests.

[简体中文](../../CHANGELOG.md) · **English**


## 0.1.2 — Early Preview

### 2026-11-08 More readable project documents; learning mode (beta)

- Project documents tell your own decisions from the AI's suggestions, mark points your answer closed as decided, state each decision once and move replaced plans to "Earlier".
- Exports open with the document status and what the marks mean, list key decisions and open questions as tables, show source code as written, and keep table rows, lists and marks intact.
- Multi-conversation organizing names source conversations, orders them by platform time and keeps different AIs' proposals apart; English conversations keep English sentences and punctuation.
- Workbench: a project is titled after its conversations, selected conversations can be reread on demand, DeepSeek messages that are only a file are read, and the empty-trash button stays when the bin is reopened.
- Two public samples, Pocket Ledger and Focus Timer (exported Wiki, ledger, run record and bilingual report), in `samples/`.
- **Learning mode (beta)**: choose **Learning (beta)** as the document type to organize study conversations into numbered cards (1.1, 1.2 …) with exercises, AI reviews, mistakes and recall questions at each chapter's end. While in beta, **Auto** always organizes as a project, and learning documents and exports say they are in beta.

## 0.1.1 — Early Preview

### 2026-10-21 multi-AI import and provider caching

- Maintainability: automatic recovery limits for writing and directory planning live in `src/ai/recovery-policy.ts` (values unchanged); fixed reading, writing, directory and cross-AI prompts have token budgets enforced by tests.
- Model roles and concurrency: reading uses the economy model, directory planning and writing use the main model, and batches the main model already read are reused; concurrency adapts from 3 up to 6 per provider and halves on rate limits.
- Settings: a smaller, fixed-height panel; main and economy models side by side with manual model IDs; one-tap analysis depth; saved connections can be switched or removed; usage history adds time ranges, per-model totals and cache reads, with developer views as secondary tabs.
- Writing batches are calibrated by provider-reported tokens (frozen per run and saved with checkpoints; reading unchanged); writing requests get a local pre-send check and impossible requests are not sent; the organization CSV adds cached input tokens, estimate deviation (including by stage), pre-send blocks and the writing scale.
- Fixed: rebuilding source inventories with scoped facts before writing could add an unassigned "Source detail" material, scheduled alone as the last batch and failing every retry with `wiki_owner_missing_or_unknown`. Writing now confirms a chapter for every material, including saved checkpoints: the outline's listing first, then the chapter of the note it extends, then shared original messages. No batch is sent without a chapter.
- Organizing scope review: groups materials into needs review, references in the Wiki and excluded, shows original messages instead of generated notes, lets references be removed, and applies changes together. Uncertain now means unclear project ownership only. Removed materials are excluded before directory planning and stay excluded in later updates.
- Cross-AI organization: mixed-platform sources tell the model which AI each passage came from, and the same question answered by different AIs is detected locally and written once as a comparison in the Wiki; after directory planning, every AI's answer to that question is placed in the same chapter and subtopic. Single-platform projects send unchanged requests.
- File import detects official exports from ChatGPT, Claude, Gemini (Google Takeout JSON) and DeepSeek by content, plus Markdown/JSON transcripts from other AIs; the import guide gives steps per platform. Gemini exports have no conversation IDs, so prompts are grouped by 30-minute gaps. Webpage sync, the native sidebar, navigation and insertion remain ChatGPT-only.
- Writing requests keep fixed instructions ahead of per-batch content for provider prompt caching. The first-party Anthropic API marks only recently repeated prefixes, the first-party OpenAI API receives a routing key, and provider-reported cached input tokens are recorded separately. Model-visible text and local cache identities are unchanged.

### 2026-10-20 local improvements

- Unified the sidebar into Search/Context. Expand saved contexts inline, retain task/source/snapshot/bulk flows and refresh collections after returning from a saved preview.
- Consolidated empty highlights into one prompt and primary action: acquire missing text or mark saved questions. Maintenance lives in the heading menu.
- Native recovery uses actual message IDs and order anchors. Partial capture preserves known message order instead of renumbering late messages to zero. Branch and live compatibility still need acceptance.
- Overview, Wiki and matters share saved facts. Distinguish supplements/replacements and adoption/delivery; unrelated reports cannot close decisions. Context supports explicit task and acceptance requirements.
- Developer tests offer quick regression, read-only project checks and a searchable manual plan, preserving old records. Local passes do not certify models.
- Added complete Simplified Chinese/English maintained guides. The first release supports ChatGPT only; other AI-platform adapters are planned without committed platforms or dates.

### 2026-10-19 release preparation

- Consolidated context presets, chapter and collection selection into one content panel; preview tools share one compact toolbar. Refinement candidates use a single reading surface, with explicit adoption and compact restore controls.

- Unified visible product name as **ChatAtlas**. Existing database, backup and message identifiers remain compatible.
- Project context defaults to local reuse of saved overview, selected whole Wiki chapters and relevant records; task matching, preview and explicit chapter controls require no model.
- Added optional **AI refinement** for quick questions and task handoffs, with candidate review, original-preview restoration, bounded requests, source-change protection and existing cache/usage reuse.
- Wiki generation separates directory planning progress, runs independent planning windows within provider limits, deduplicates identical notes and recovers failed writing locally with bounded budgets.
- Simplified sidebar highlights and secondary project features. Questions and new evolution analysis are marked experimental; saved history remains readable. Semantic controls live in advanced settings.
- Updated current user/developer/privacy documentation. Historical notes, private examples and diagnostics stay local and outside the public source list.
- Source packaging includes both HTML entry points, all required test fixtures, current guides and license; explicit public-file checks and verified archives support GitHub preparation.
- Patched the transitive build dependency `source-map-js` from 1.2.1 to 1.2.2 for GHSA-68fv-2mgg-jv7q; runtime dependencies are unchanged.

The public frontend uses BYOK and does not require a shared backend. Real-model latency, cost and quality must be measured separately from automated simulated tests.
