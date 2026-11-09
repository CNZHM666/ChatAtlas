# ChatAtlas GitHub release checklist

[简体中文](../RELEASE_CHECKLIST.md) · **English**

Target: public frontend source and an unpacked Chrome extension for **0.1.2 Early Preview**, without a shared backend. This checklist does not certify live acceptance.

Distinguish multi-platform file import, ChatGPT bulk history sync and native sidebar, and optional Beta page capture for Claude/Gemini/DeepSeek. Context reuse and BYOK selection do not establish website integration.

## Reproducible build

```bash
npm ci
npm run check
npm run check:public
npm audit --registry=https://registry.npmjs.org
pwsh -File scripts/package-demo.ps1
```

Complete checks before packaging. Extract the generated source ZIP to a clean directory and repeat `npm ci`, `npm run check` and `npm run check:public`. Verify both HTML entries, configuration, scripts, fixtures, current guides in both languages and LICENSE. The extension ZIP should contain `manifest.json`, `atlas.html` and `sidecar.html` directly, with no development loaders.

Packaging uses an explicit public-file manifest, produces `SOURCE_FILES.txt` and SHA256 checksums, and never pushes, creates a Release or deploys. Build outputs, `.env`, private examples, diagnostics, historical archives and deployment files are excluded. Public checks also reject Git-tracked files outside the manifest.

## Browser acceptance

Use a fresh profile and fictional material:

- Load the extension and open ChatGPT. Check branding, page entry, sidebar and shortcuts. Closing/switching chats must not automatically reopen or send.
- Exercise ZIP/JSON import, webpage sync, pause/resume and protection against empty/older overwrites.
- Confirm default local search makes no model calls. Open full originals and verify source return and reading position.
- Read saved projects offline; check chapter edits, collections and backup/restore.
- Pack context without an API; explicitly selected chapters stay complete, edits survive and copy/export agree.
- Start refinement explicitly; check failure/cancellation retain the original, adoption/restoration are explicit, stale candidates are blocked and composer drafts survive.
- Check experimental question/evolution labels, gated architecture generation and advanced semantic controls.
- Check light/dark/narrow layouts, local code scrolling and no page overflow.
- Search shows no discussion highlights directory or marking controls. Results support native location and Reader reading. The unified Context page retains task/source/edit state through collection and original-reading flows.
- Test native navigation after export import, partial visible capture, middle-history loading and branch changes. Calling a scroll API alone does not prove successful navigation.
- Check both documentation editions, language links and their inclusion in the public source manifest.

Local DOM fixtures do not verify the current live ChatGPT page.

## Real-model acceptance

Run only with material you authored or have permission to send. Record provider, exact model ID, input/output tokens, total duration, actual or unknown cost, failures and recovery attempts.

| Scenario | Check |
| --- | --- |
| First short/long organization | Final choices, corrections, conditions and sources |
| Same material or interrupted continuation | Completed batches reused, no repeated full read or no-progress loop |
| Source additions/edits/deletions | Affected knowledge updated, edits retained, no invented resolution |
| Quick-question refinement | Shorter output, retained negation and proposal status, explainable cost |
| A new AI receiving only the context pack | Correct background/task/unknown interpretation, assessed with fixed questions |

Mocked tests cannot replace these measurements. Without evidence, do not advertise fixed speed, compression or universal model reliability. Builds do not run paid evaluations automatically.

## GitHub steps

1. Commit only files in the public manifest, including MIT and third-party notices. Do not upload the entire local workspace.
2. Run `npm run check:public` before the first push and inspect staging. `.gitignore` does not remove tracked files.
3. Wait for actual GitHub Actions success, then create a Release matching the source version.
4. Attach `ChatAtlas-extension-v0.1.2.zip`, optional source ZIP, SHA256 checksums and actual validation notes.
5. State Early Preview, ChatGPT native features and optional Beta capture, BYOK, local data and known limitations.

Local preparation does not mean pushing, publishing, live CI execution or paid model acceptance has happened.

## Optional page-capture acceptance

- Verify each signed-in site: no capture before opt-in, loaded messages after enable, no writes after disable, no model requests. Check roles, code/tables, stream completion, partial history, navigation and deduplication.
- DOM fixtures and production build tests do not establish live compatibility. The new adapters have not yet passed signed-in live-site acceptance and retain Beta labels.
- Check AI categories with sync/search filters, retained selection and narrow screens in the home source list, with text search, reading originals and adding to a project. Gemini Takeout time groups do not match native webpage conversation IDs; automatic merging is not promised.

## Performance benchmarks

In Settings → Usage history → Developer tests, run local checks, then organize a fixed redacted sample in a separate project. After each run, choose **Export latest run CSV** and save baseline/candidate files. Select both CSVs in the same panel to compare calls, stages, tokens, cache reads, failure origins and latency, then export comparison JSON. Use Diagnostics to export other runs.

Offline reproduction (repeat `--sample` for multiple files):

```sh
npm run benchmark:organization -- --sample redacted-export.json --before baseline.csv --after candidate.csv --json comparison.json
```

Omit `--after` for a single baseline. This reads local files and fingerprints samples with SHA-256; it neither imports/modifies projects nor calls a model. Developers must redact samples themselves. Missing time/cache metrics remain unknown. First-readable latency is the median of measured runs; elapsed time sums run durations, not overlapping request times. Old CSVs without failure provenance remain unknown. Verify sample fingerprints, message scope, models, run counts, cache conditions and completion status. Inspect chapters, citations and original conditions separately; speed improvements do not prove unchanged quality.

Manually constructed fixtures exercise the tool, not real model performance:

```sh
npm run benchmark:organization -- --sample scripts/fixtures/organization-benchmark/sample.json --before scripts/fixtures/organization-benchmark/before.csv --after scripts/fixtures/organization-benchmark/after.csv
```
