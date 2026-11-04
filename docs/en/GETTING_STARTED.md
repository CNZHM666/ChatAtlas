# Getting started with ChatAtlas

[简体中文](../GETTING_STARTED.md) · **English**

File import accepts official exports from ChatGPT, Claude, Gemini (Google Takeout JSON) and DeepSeek, plus Markdown/JSON transcripts from other AIs. Beta website adapters for Claude, Gemini, DeepSeek, Doubao, Kimi and Qianwen (including Qwen international) run automatically after browser website permission, with pause/resume controls. They support the native sidebar, local search, project association, loaded-message sync, source location and composer insertion. Website history import reads loaded titles and saves loaded bodies one at a time; it saves currently loaded messages, not guaranteed full history. ChatGPT retains its dedicated history inventory and body sync. The new adapters still need signed-in live-site acceptance; BYOK model providers are independent of conversation-source support.

Supported AI websites run automatically after installation/update and browser website permission. Use **Settings → Capture & data → Automatic page capture** to pause or resume a platform. Open a signed-in conversation to save loaded messages locally as the page changes. Capture makes no model calls and never rewrites documents automatically. The home source list has AI category filters; sync counts follow the selected category. ChatGPT, Claude, Gemini, DeepSeek and GLM have direct categories; Kimi, Doubao, Qwen, Grok, Yuanbao and other sources are available in the icon-based More AIs menu. Categories filter imported sources and do not imply automatic page capture for every listed platform.

## Import and find discussions

Load the extension from source or a published Release, then open the workbench from its icon. Import, local search, reading, existing knowledge and the example do not need an API key.

Scan ChatGPT conversation titles and sync selected text, or import a ChatGPT ZIP/JSON export. Web sync needs a signed-in ChatGPT browser session; file import is a fallback. A visible title does not mean its complete text has been saved, and visible webpage messages do not represent all history.

Search saved titles and text in the home source list. The read button at the end of a row opens the matching user question and its answers in original order. Rows name their projects, and a selection can join an existing project. Returning preserves reading position. Routine keyword search needs no embedding setup.

## Organize your first project

1. In **Settings → AI connection**, choose a provider, enter your key, select a model, test and save. Advanced settings accept an exact model ID for compatible endpoints.
2. Select your source scope and wait for its text to be available. A scope supports up to 24 conversations.
3. Enter a concrete goal, such as “Organize the architecture, final choices and unresolved questions,” then explicitly start.
4. Long material goes through initial reading, Wiki planning and writing. Time and cost depend on the material and model.
5. Review the overview, chapters and originals, make changes and save.

Model requests go directly to your selected provider. Connection tests may also incur charges. Valid completed steps can be reused after failure; refreshing does not automatically resend paid requests. Review missing, uncertain or conflicting evidence instead of interpreting generation status as implementation proof.

## Read and maintain

The overview introduces the project and maintained matters. Wiki holds lasting detail. Open chapter navigation, source comparisons or continuous originals when needed. Previous/next navigation follows saved reading order and does not mark content understood automatically.

Add, edit and resolve personal matters without implying a historical feature was delivered. Preview updates before adopting them; personal edits are not silently overwritten. New project questions and evolution analysis are experimental under secondary features; saved history remains readable. Architecture AI generation is gated; existing diagrams remain available.

## Use the AI website sidebar

ChatGPT retains its page entries. The six other supported AI website adapters automatically show a ChatAtlas button after browser website permission. Open the native sidebar from that button, the extension icon or Ctrl+Shift+Y.

The sidebar shows the current conversation, local search and project association. Import or update this conversation, search saved material, then locate an original question or read continuously in Reader. Linking a conversation does not automatically rewrite project documents. Export the overview and Wiki from the workbench.

Enter a keyword, then locate a matching message or open it in Reader. ChatGPT navigation can try to load earlier messages; the new adapters locate loaded messages. After an upgrade, reload the extension, accept browser website permissions and refresh the AI pages to replace old scripts.

The composer adapters support ChatGPT and the six Beta websites. Explicit insertion fills an empty composer without sending and preserves existing drafts. The new adapters still need signed-in live-site acceptance.

## Hand knowledge to another AI

Open **Use project context**, enter a task, choose chapters automatically or manually and review before copying, exporting or saving. Default packing is local and has no model cost. You can manually paste the output into another AI.

For a shorter draft, open **AI refinement** and choose a quick question or task handoff. Only the reviewed preview and task are sent to the configured model. Review the candidate before adoption; the original can be restored. See [Context](CONTEXT.md).

## Backups and troubleshooting

Download a backup in **Settings → Capture & data** before uninstalling, clearing data or changing extension identity. Restore replaces local knowledge. API keys are excluded.

- Cannot generate: check selected sources, saved text, goal and AI connection.
- Cannot list models: check provider, region and permissions, or enter the provider's documented exact model ID.
- Refinement over budget: reduce chapters. Whole chapters are not silently cut or automatically split into paid rounds.
- Long wait: inspect the actual stage and usage records. The first complete read still has a real input cost.
- Sources changed: saved knowledge remains readable, but review originals and update the preview before relying on current status.
