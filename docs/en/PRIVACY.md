# ChatAtlas data and privacy

[简体中文](../PRIVACY.md) · **English**

Conversations, source versions, projects, notes, the knowledge ledger, reading state, analysis caches and API configuration remain in the current browser. The public version provides neither a shared AI service nor knowledge cloud sync. Export files are chosen by you and read locally. Website capture for Claude, Gemini, DeepSeek, Doubao, Kimi and Qianwen (including Qwen international) runs automatically after browser website permission. Revoking a site's permission stops capture and retains saved material. Capture makes no model calls or uploads to ChatAtlas servers.

## When data leaves the device

- Web scanning, sync and capture access ChatGPT for the selected material. Export files are parsed locally.
- Explicit Wiki generation or updates send the necessary material from the selected scope and the task directly to your chosen provider. Recovery and retries may resend the affected material.
- Optional semantic enhancement and embedding indexing can send relevant content to the configured provider; these are advanced settings.
- Explicit connection tests may send small requests and incur charges.
- Reading, local keyword search, editing, and export run locally. Export can include original quotes and source IDs. Review sensitive content before sharing a file.

Provider handling depends on its policies and your configuration. ChatAtlas does not proxy BYOK keys or generation requests through its own server.

## Keys and caches

API keys are stored in the current browser and excluded from knowledge backups. Browser storage is not an independent key vault. Protect the device and profile, and never upload configuration, backups or keys to a public repository.

Validated extraction and writing results may be cached locally for reuse. Usage diagnostics retain phase, model, duration and token metadata. Full diagnostic exports may include private project metadata. Redact them before sharing. Billing can remain unknown even when a task is canceled.

## Extension permissions

Fixed host permissions cover ChatGPT and the six AI website adapters and their listed aliases, granted by the browser on install or update. Custom API endpoints still request optional access. `storage` holds local configuration; `tabs`/`scripting` connect supported AI websites and the workbench; `alarms` maintain sync inventory; `sidePanel` supports the native browser sidebar. Opening a sidebar does not import an ordinary webpage as an AI conversation. Explicit selected-history imports open inactive tabs one at a time to read loaded bodies; a tab the user activates is retained. The extension does not automatically open every account conversation.

Insertion fills the composer without sending. Existing input drafts are preserved, with copying as a fallback.

## Backups and feedback

Backups contain private conversation text and personal records and are saved only to your chosen location. Restore replaces local knowledge; keys are excluded. Back up before uninstalling, clearing browser data or changing extension identity.

Report the version, model, error code and reproduction steps. Remove keys, account information and private text; prefer fictional examples. Historical diagnostics, real private context examples, deployment files and machine-specific instructions are outside the public source package.
