# ChatAtlas first release

[简体中文](../FIRST_RELEASE_OVERVIEW.md) · **English**

Version **0.1.1 Early Preview**. This describes available entries and limits, not a promise of testing across every model.

## Supported platform

File import accepts official exports from ChatGPT, Claude, Gemini (Google Takeout JSON) and DeepSeek, plus Markdown/JSON transcripts from other AIs. Beta website adapters for Claude, Gemini, DeepSeek, Doubao, Kimi and Qianwen (including Qwen international) run automatically after browser website permission, with pause/resume controls. They support the native sidebar, local search, project association, loaded-message sync, source location and composer insertion. Website history import reads loaded titles and saves loaded bodies one at a time; it saves currently loaded messages, not guaranteed full history. ChatGPT retains its dedicated history inventory and body sync. The new adapters still need signed-in live-site acceptance; BYOK model providers are independent of conversation-source support.

You can copy or export context for manual use in another AI. Selecting a BYOK model provider also does not imply conversation import or sidebar support for its website.

## Available capabilities

| Status | Capability |
| --- | --- |
| Main path | ChatGPT ZIP/JSON and webpage import, local keyword search, continuous originals, confirmed scope, overview/Wiki generation, review/save, personal edits and sources |
| Main path | Search/Context sidebar, discussion navigation, local preparation, inline saved contexts, copy and draft-preserving insertion |
| Main path | Local packs from saved overview/Wiki, task and chapter selection, optional refinement with candidate adoption/restoration |
| Main path | Backup/restore, successful-analysis reuse, bounded recovery, request and usage records |
| Main path | Organize one or multiple conversations into an overview/Wiki; review, edit, update on demand and export Markdown/printable HTML |
| Legacy compatibility | Independent project Q&A, matters and evolution workspaces are retired; data remains and saved matters/evolution can be exported |
| Advanced optional | Semantic search, embeddings and explicit indexing |
| Gated | Architecture AI generation; existing content readable and maintainable |
| Unavailable | Knowledge cloud sync, shared paid AI service, complete native integration with other platforms |

One scope supports up to 24 conversations. Initial complete analysis of long material still consumes input and output tokens. References and program checks are not factual proof, and personal completion marks do not establish code delivery.

Use the preview to validate the path **import your material → organize → read → hand context to a new AI**. Record real-model completeness, time, cost and current ChatGPT compatibility separately from mocked tests using the [release checklist](RELEASE_CHECKLIST.md).
