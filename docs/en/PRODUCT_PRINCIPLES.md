# ChatAtlas product principles

[简体中文](../../PRODUCT_PRINCIPLES.md) · **English**

Updated 2026-10-22. These principles describe product choices; current code and maintained guides describe implementation. Historical discussions do not prove delivery.

File import accepts official exports from ChatGPT, Claude, Gemini (Google Takeout JSON) and DeepSeek, plus Markdown/JSON transcripts from other AIs. Beta website adapters for Claude, Gemini, DeepSeek, Doubao, Kimi and Qianwen (including Qwen international) run automatically after browser website permission, with pause/resume controls. They support the native sidebar, local search, project association, loaded-message sync, source location and composer insertion. Website history import reads loaded titles and saves loaded bodies one at a time; it saves currently loaded messages, not guaranteed full history. ChatGPT retains its dedicated history inventory and body sync. The new adapters still need signed-in live-site acceptance; BYOK model providers are independent of conversation-source support.

## Core value

Help users recover understanding they have already formed: **keep past discussions useful and make learned knowledge easy to revisit.** Judge features by review efficiency, clarity and simplicity, not graph complexity or feature count.

## Responsibilities

- Sidecar: current conversation, local search and project linking, with short interactions and low density. Remove the separate project-context entry; export the overview and Wiki together from the workbench.
- Conversation Canvas/library: source material and continuous discussion in original question/answer order.
- Knowledge Space: user intent and confirmed Source Scope define the space. AI proposes; the user owns the knowledge.
- Reader: the intended reading path is Knowledge Graph → Reader → continuous context → previous/next knowledge. Native-platform navigation is a source-tracing fallback.
- Overview: brief document description, chapter reading order and sources; lasting detail belongs in Wiki.

The main flow is select conversations → organize a document → review and edit → update on demand → export. A single conversation or multiple conversations across platforms can supply the material. Project navigation contains only the document overview, Wiki chapters and sources. Independent project Q&A, matters and evolution workspaces are retired. Ordinary document updates no longer append project-state, architecture or matters analysis; chapter ownership, source checks, update previews and personal-edit protection remain. Historical data is retained: saved matters and evolution can be selected under Previously saved records in export; old Q&A threads remain in local storage and backups without regeneration.

## Knowledge and provenance

Keep original material, generated explanation and personal maintenance distinct. Preserve continuity and the user's learning path across conversations. AI suggestions, direct confirmation, user reports, personal workflow status and verified code delivery are different. A pasted suggestion inside a user message does not prove adoption.

Compare subjects, operating modes, versions and prerequisites before declaring a conflict. Parallel modes such as platform-provided AI and user BYOK do not replace each other merely by chronology. Consolidating repetition must retain their distinct conditions and sources. Tangential discussion is not automatically a current-project feature; relevance-routing proposals must preserve originals and the user's ability to include them, without silent keyword deletion.

Do not silently expand source scope. Preserve traceable quotes, roles, order and source versions. Report changed sources; unknown dates do not become sync timestamps. Missing/deleted material does not prove resolution. Saving or reading does not confirm truth.

Never overwrite or silently truncate personal edits, drafts, snapshots, original code or conditions. Preview updates before adoption. Do not turn errors into content or partial material into supposedly complete results. Retain successful batches after failure. Cancellation and source changes block stale publication.

## Producing and consuming knowledge

Production: original discussions → confirmed scope → bounded AI reading/organization → user review/edit → saved overview/Wiki.

Consumption: read saved overview/Wiki → select content → export project files → upload or reuse in another AI. Use the existing export dialog rather than separate project-context packing, task handoff or AI-refinement entries. Export makes no model call and retains complete selected chapters, qualifications and personal edits. Removing entries does not erase old collections or backup data.

Ordinary reading, keyword search and basic packing do not invoke models. Semantic/embedding controls are advanced; experiments are secondary and existing history remains readable. Native insertion never sends automatically or overwrites an existing draft.

## Development and release

Respect the explicit task scope. Product discussion alone does not authorize implementation. Reuse analysis and successful requests; renaming does not clear caches. Keep concurrency/recovery bounded, and never discard original conditions merely to reduce a bill. Automated simulation is not live-model validation.

Use **ChatAtlas** as the visible product name. Retain legacy `AtlasAI`, `atlas-*`, database and backup identifiers where needed for compatibility. Historical implementation notes cannot override current product direction or explicit user scope.
