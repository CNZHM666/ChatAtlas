# Getting started with ChatAtlas

[简体中文](../GETTING_STARTED.md) · **English**

Follow the [three-step installation guide](../../README.md#install-on-chrome-or-edge) to load ChatAtlas in Chrome or Edge.

File import accepts official exports from ChatGPT, Claude, Gemini (Google Takeout JSON) and DeepSeek, plus Markdown/JSON transcripts from other AIs. Beta website adapters for Claude, Gemini, DeepSeek, Doubao, Kimi and Qianwen (including Qwen international) run automatically after browser website permission. They support the native sidebar, project association, loaded-message sync, source location and composer insertion. Website history import reads loaded titles and saves loaded bodies one at a time; it saves currently loaded messages, not guaranteed full history. ChatGPT retains its dedicated history inventory and body sync. The new adapters still need signed-in live-site acceptance; BYOK model providers are independent of conversation-source support.

Supported AI websites run automatically after installation/update and browser website permission. You can stop capture for a site by revoking its browser website permission. Open a signed-in conversation to save loaded messages locally as the page changes. Capture makes no model calls and never rewrites documents automatically. The home source list has AI category filters; sync counts follow the selected category. ChatGPT, Claude, Gemini, DeepSeek and GLM have direct categories; Kimi, Doubao, Qwen, Grok, Yuanbao and other sources are available in the icon-based More AIs menu. Categories filter imported sources and do not imply automatic page capture for every listed platform.

## Manage projects and sources

Load the extension from source or a published Release, then open the workbench from its icon. Import, local search, reading, existing knowledge and the example do not need an API key.

Scan ChatGPT conversation titles and sync selected text, or import a ChatGPT ZIP/JSON export. Web sync needs a signed-in ChatGPT browser session; file import is a fallback. A visible title does not mean its complete text has been saved, and visible webpage messages do not represent all history.

The workbench has a project composer and a saved projects list. Choose **Add chats** in the composer to select sources.

## Organize existing material

1. In **Settings → AI connection**, choose a provider, enter your key, select a model, test and save. Advanced settings accept an exact model ID for compatible endpoints.
2. Select your source scope and wait for its text to be available. A scope supports up to 24 conversations.
3. Enter a concrete goal, such as “Organize the architecture, final choices and unresolved questions,” then explicitly start.
4. Long material goes through initial reading, Wiki planning and writing. Time and cost depend on the material and model.
5. Review the overview, chapters and originals, make changes and save.

Model requests go directly to your selected provider. Connection tests may also incur charges. Valid completed steps can be reused after failure; refreshing does not automatically resend paid requests. Review missing, uncertain or conflicting evidence instead of interpreting generation status as implementation proof.

## Read and maintain

The overview introduces the project and maintained matters. Wiki holds lasting detail. Open chapter navigation, source comparisons or continuous originals when needed. Previous/next navigation follows saved reading order and does not mark content understood automatically.

Open **Review evidence** to read the original quote and surrounding conversation. The Wiki marks confirmed decisions, AI suggestions, user reports, and items needing review. Start an update from the overview when sources change. Preview changes before adoption. Personal edits are preserved, and previously saved matters and history are available in the export dialog.

## Use the AI website sidebar

ChatGPT retains its page entries. The six other supported AI website adapters automatically show a ChatAtlas button after browser website permission. Open the native sidebar from that button, the extension icon or Ctrl+Shift+Y.

Choose **New** to create an empty project. When the discussion makes progress, select the update icon, inspect the source quotes and apply the selected entries. Keep entries as project notes or append them to an existing chapter. New chapters are optional suggestions. Use **Mark as decided** to confirm an entry as a decision. The side panel also supports undoing the last write.

In another AI tab, open the same project in the sidebar and select the update icon to review the new discussion before adding it. Open a chapter to read or edit it, or select **Export** to download the saved Markdown. Choose **Open workspace** to review the full citations.

**Files** keeps images, PDFs, code, and text handy. When you attach a file in a linked chat, confirm the small on-page prompt to save it. Enable **Auto-save uploads in this chat** to automatically collect supported files up to 20 MB. Larger files require confirmation, and the per-file limit is 64 MB. Try dragging a file into the composer, or download it. Use **Notes** for quick ideas and questions.

After an upgrade, reload the extension, accept browser website permissions and refresh the AI pages to replace old scripts.

The composer adapters support ChatGPT and the six Beta websites. Explicit insertion fills an empty composer without sending and preserves existing drafts. The new adapters still need signed-in live-site acceptance.

## Hand knowledge to another AI

Open **Export** in the workbench, select the overview and relevant Wiki chapters, and choose Markdown. Use **Select overview only** for a short handoff. Choose reference numbers, key quotes and confirmations, or cited excerpts. The file is generated locally and can be shared with another AI.

## Backups and troubleshooting

Download a backup in **Settings → Local data** before uninstalling, clearing data or changing extension identity. Restore replaces local knowledge. API keys are excluded.

- Cannot generate: check selected sources, saved text, goal and AI connection.
- Cannot list models: check provider, region and permissions, or enter the provider's documented exact model ID.
- Export too long: select just the overview and chapters relevant to the task.
- Long wait: inspect the actual stage and usage records. The first complete read still has a real input cost.
- Sources changed: saved knowledge remains readable, but review originals and update the preview before relying on current status.
