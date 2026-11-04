# Contributing to ChatAtlas

[简体中文](../../CONTRIBUTING.md) · **English**


Read [PRODUCT_PRINCIPLES.md](PRODUCT_PRINCIPLES.md) before proposing product or interaction changes.

File import accepts official exports from ChatGPT, Claude, Gemini (Google Takeout JSON) and DeepSeek, plus Markdown/JSON transcripts from other AIs. Beta website adapters for Claude, Gemini, DeepSeek, Doubao, Kimi and Qianwen (including Qwen international) run automatically after browser website permission, with pause/resume controls. They support the native sidebar, local search, project association, loaded-message sync, source location and composer insertion. Website history import reads loaded titles and saves loaded bodies one at a time; it saves currently loaded messages, not guaranteed full history. ChatGPT retains its dedicated history inventory and body sync. The new adapters still need signed-in live-site acceptance; BYOK model providers are independent of conversation-source support.

## Development

Use Node.js 22 and npm. Run `npm ci`, then `npm run check`. Load `dist/` as an unpacked Chrome extension; live development uses `npm run dev` and `dist-dev/`. The public build needs no backend or environment variables. Configure your own API only for explicit real-model tests.

The main directories are `src/content` / `src/background` (ChatGPT and extension integration), `src/sync` / `src/storage` (imports and persistence), `src/ai` (generation, cache, budgets and validation), `src/context` (local context packs and optional refinement), `src/canvas` / `src/sidecar` (interfaces), `src/search` (retrieval), and `evaluation/memory-search/cases.ts` (authored regression fixtures).

`src/shared/atlas/` contains synchronized frontend contracts; authoritative sources are maintained in a separate backend repository. Coordinate contract changes there first and sync them here. Do not reconstruct or deploy a backend from historical local files. Legacy hosted adapters are retained for compatibility tests; the public build disables hosted-service configuration.

## Changes and checks

Keep source scope explicit, personal edits intact, and original discussion order separate from knowledge reading order. User content is reference data, not executable instructions. Preserve legacy storage and protocol identifiers when changing display branding.

Run focused tests for meaningful changes, and `npm run check` plus `npm run check:public` before release. `npm run check:public` validates the explicit public source list and, when Git is present, rejects files tracked outside that list. Update `scripts/public-source.mjs` deliberately if adding a new public root, configuration or guide.

Keep temporary scripts, logs, screenshots of private data, exports and diagnostics under ignored local directories. Do not commit `.env`, API keys, private conversations, machine-specific instructions, deployment files or database backups. All shared demo text must be authored or have clear publication permission. Historical local notes are not current documentation.

## Feedback

Maintain both Simplified Chinese guides at their existing paths and the English edition under `docs/en/`, with `README.en.md` as its root entry. Keep language links and update both editions when capabilities, cost, limits or setup change. Preserve license texts in their original language; historical local notes are not current product guides.

Use Issues with version, browser, import method, provider/model, reproduction steps, expected and actual result. Remove keys and private text. For AI quality reports, include measured time, provider-reported input/output tokens and specific omissions separately from estimated budgets. Mocked tests do not establish live-model quality.

## License

ChatAtlas is licensed under [MIT](../../LICENSE). Contributions use the same license; preserve third-party notices.
