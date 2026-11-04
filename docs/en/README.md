# ChatAtlas documentation

[简体中文](../README.md) · **English**

File import accepts official exports from ChatGPT, Claude, Gemini (Google Takeout JSON) and DeepSeek, plus Markdown/JSON transcripts from other AIs. Beta website adapters for Claude, Gemini, DeepSeek, Doubao, Kimi and Qianwen (including Qwen international) run automatically after browser website permission, with pause/resume controls. They support the native sidebar, local search, project association, loaded-message sync, source location and composer insertion. Website history import reads loaded titles and saves loaded bodies one at a time; it saves currently loaded messages, not guaranteed full history. ChatGPT retains its dedicated history inventory and body sync. The new adapters still need signed-in live-site acceptance; BYOK model providers are independent of conversation-source support.

| Guide | Purpose |
| --- | --- |
| [Getting started](GETTING_STARTED.md) | Installation, import, first project and sidebar |
| [Project export](CONTEXT.md) | Export saved overview and selected Wiki chapters |
| [Privacy](PRIVACY.md) | Storage, outbound requests, permissions and backups |
| [First release](FIRST_RELEASE_OVERVIEW.md) | Available, experimental and unavailable capabilities |
| [Release checklist](RELEASE_CHECKLIST.md) | Build, manual acceptance, packaging and GitHub preparation |
| [Dependency notices](../THIRD_PARTY_NOTICES.md) | Dependencies and original licenses |
| [Context template](examples/project-context-template.md) | A template without private project material |
| [Architecture](ARCHITECTURE.md) | Modules, data and responsibilities |
| [AI workflows](AI_WORKFLOWS.md) | Model calls, reuse, budgets and validation limits |
| [Product principles](PRODUCT_PRINCIPLES.md) | Shared product direction |
| [Contributing](CONTRIBUTING.md) | Development, checks and feedback |
| [Changelog](CHANGELOG.md) | Preview release changes |

Each maintained guide links to its Simplified Chinese counterpart. License texts and dependency notices are shared in their original language. Local historical archives, private examples and diagnostics are not current guides or part of the public source manifest. Start from the [English README](../../README.en.md).
