# ChatAtlas

[简体中文](README.md) · **English**

**Keep past conversations useful. Revisit what you have learned.**

**Basic search needs no AI key and is ready as soon as you install.** Import or save conversations, then search titles and text locally and read the original discussions. Organizing documents uses your own API key (BYOK): material goes directly to the provider you choose, and there is no ChatAtlas server.

ChatAtlas is a local-first Chrome extension. It saves your conversations from AI websites in your browser so you can find what was said and read it in order again. When you need to, it organizes selected discussions into a project overview and Wiki that trace back to their sources.

> **Early preview (0.1.1 Early Preview).** Features, interactions and data structures will still change. Wiki organization is experimental: check what it writes against the sources. Back up local data before upgrading.

> Demo GIF placeholder: recording pending (install → import → search without a key → read originals → organize a Wiki).
<!-- demo-gif-placeholder: Recording pending; no demo file yet. -->

## What it does

- **Save conversations**: import official export files, or let supported AI websites save loaded conversations automatically. Everything stays in the current browser.
- **Find what was said**: keyword search covers titles and text; open a result to read the discussion in its original order, or locate it on the original website.
- **Side panel for the current conversation**: search local records, link a project, and fill the composer (never sent automatically, never overwriting a draft you typed).
- **Organize into a Wiki**: choose conversations and a goal to generate a project overview and Wiki. It asks you where your judgment is needed, before and while writing; you preview before saving.
- **Hand off to another AI**: export the overview and selected chapters as Markdown, plain text, HTML (printable to PDF) or JSON, and attach the file elsewhere. Export makes no model call.

What each part is for:

| Part | Purpose |
| --- | --- |
| Sidecar | The current conversation, local search and project links; short actions, little on screen |
| Conversation library | The original material, in its original question-and-answer order |
| Knowledge Space | What to organize, decided by your goal and the sources you confirm |
| Reader | Continuous reading along knowledge and its related originals |
| Overview and Wiki | The overview gives a short introduction, reading order and sources; lasting detail lives in the Wiki |

The intended reading path is knowledge graph → Reader → continuous context → previous/next knowledge. That is the direction, not yet fully built. See the [product principles](docs/en/PRODUCT_PRINCIPLES.md).

## Supported platforms

| Method | Platforms |
| --- | --- |
| Import official exports | ChatGPT (ZIP/JSON), Claude, Gemini (Google Takeout JSON), DeepSeek; Markdown/JSON transcripts from other AIs |
| Automatic website saving | ChatGPT (dedicated history list and body sync); Claude, Gemini, DeepSeek, Doubao, Kimi and Qianwen (including Qwen international) in beta |

Website adapters run automatically after browser website permission; pause or resume each platform in **Settings → Capture & data → Automatic page capture**. Except on ChatGPT, website saving saves currently loaded messages, not guaranteed full history; for a long conversation, load earlier messages on the website first. The newer platforms have not each been accepted while signed in, and a website redesign can break saving; file import is the fallback. Saving makes no model call.

## How a Wiki is organized

1. **Choose material**: select source conversations (up to 24, across platforms) and write what you want organized.
2. **Before writing**: other projects and products named in the material are listed, and you tick the ones to leave out of the Wiki, with no model involved. The model then asks about the few points that change the conclusions, such as which of two roadmaps counts or which stage a limit belongs to. Your answers outrank the AI's inferences.
3. **While writing**: a point it cannot state faithfully is asked about at once; your answer revises only the paragraphs concerned, not the whole chapter.
4. **Review and save**: preview, then save. Later you can rewrite a chapter or update from new material; your own edits are protected.

The document contains:

- **Project overview**: at a glance, the **current baseline** (doing now / not now / done when), key decisions and source scope.
- **Wiki chapters**: organized by subject, each point explained once, with the source's numbers, code and conditions kept.
- **Sentence marks**: 〔已定〕 decided by you, 〔未定〕 still open, 〔此前〕 replaced by a later plan, 〔你〕 your own view or report, 〔资料〕 material you pasted. Unmarked text is the AI's suggestion or analysis. "Done" means you reported it, not that the code was verified.
- **Document information and evidence notes**: source scope, automatic check results and messages no point was extracted from. Automatic checks can miss problems and can report false ones.

Citations take you back to the original to check; they do not prove a suggestion was adopted. Long material takes substantial time and tokens; successful reading and writing are reused for the same input, and a failure keeps the finished parts.

## Install and try

If a maintainer has published a Release, download and extract `ChatAtlas-extension-v0.1.1.zip`; otherwise build it as described under "Build from source".

1. Open `chrome://extensions` in Chrome and turn on Developer mode.
2. Choose **Load unpacked** and select the folder containing `manifest.json` (`dist/` for a source build).
3. Open the workbench from the extension icon, then import an export file or open a supported AI website to save conversations automatically.
4. Searching and reading need no API key. To organize documents, choose a provider in **Settings → AI connection**, enter your key, pick a model and test the connection.
5. Create a knowledge space: choose sources, write a goal, answer the questions before writing, then review and save the result.

Before upgrading, download a backup from **Settings → Capture & data** (backups contain no API key). Never commit private backups or exports to GitHub.

## Data and privacy

- Conversations, projects, saved items and AI settings stay in the current browser. There is no cloud sync and no ChatAtlas server.
- Material is sent only when you use AI (organizing, semantic search), and then directly to the provider you chose.
- Searching, reading and exporting make no model call.
- Back up before uninstalling the extension or clearing browser data.

See the [privacy notes](docs/en/PRIVACY.md). Report security problems privately as described in the [security policy](SECURITY.md).

## Current limitations

- Wiki quality varies with the material and the model, and repeated runs on the same material can differ; check key conclusions against the originals.
- Automated tests use a mocked provider; they do not establish completeness, cost or success rates on real long conversations or every model.
- Automatic website saving depends on each site's page structure and can stop working after a redesign.

## Generation time

Pending benchmark measurements. Time to the first readable chapter, time to completion and model are intentionally blank below; no measured results are available to publish yet. Search and reading need no generation.

| Conversation size | First readable chapter | Fully complete | Model |
| --- | --- | --- | --- |
| Single conversation |  |  |  |
| Multiple conversations |  |  |  |

## Build from source

Use Node.js 22 and npm:

```bash
npm ci
npm run check
```

Then load `dist/` in Chrome. For development, run `npm run dev` and load `dist-dev/`. No `.env` or backend is needed.

```bash
npm run check:public
npm run eval:wiki -- <cases.json> <export.md>
```

`check:public` verifies the public source holds no credentials, machine paths or files outside its list. `eval:wiki` scores an exported Wiki against cases you label yourself and averages several exports; keep cases and exports local, since they contain private material. Release steps are in the [release checklist](docs/en/RELEASE_CHECKLIST.md).

## Documentation and feedback

[Getting started](docs/en/GETTING_STARTED.md) · [Documentation](docs/en/README.md) · [Export guide](docs/en/CONTEXT.md) · [Architecture](docs/en/ARCHITECTURE.md) · [AI workflows](docs/en/AI_WORKFLOWS.md) · [Contributing](docs/en/CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](docs/en/CHANGELOG.md)

Report reproducible problems in Issues with the extension and browser version, import method, model, steps and expected result. Remove API keys and private conversation text.

## License

[MIT](LICENSE). Third-party components keep their own licenses; see the [dependency notices](docs/THIRD_PARTY_NOTICES.md).
