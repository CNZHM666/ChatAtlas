# ChatAtlas

[简体中文](README.md) · [Changelog](docs/en/CHANGELOG.md) · [Report an issue](https://github.com/CNZHM666/ChatAtlas/issues)

Save your AI conversations and find the original messages again. Turn long discussions into a project Wiki with references you can share with a teammate or another AI.

**Search and reading need no API key.** AI organization uses the provider you configure.

## Install on Chrome or Edge

**[Download ChatAtlas (ZIP)](https://github.com/CNZHM666/ChatAtlas/releases/download/v0.1.4/ChatAtlas-extension-v0.1.4.zip)** · [Release notes](https://github.com/CNZHM666/ChatAtlas/releases/tag/v0.1.4)

1. Download the ZIP and extract it to a folder you can keep.
2. In the address bar, enter `chrome://extensions` for **Chrome** or `edge://extensions` for **Edge**. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the extracted folder containing `manifest.json`.

Open **ChatAtlas** from the browser's Extensions menu. The same ZIP works in both browsers. This early preview is distributed through GitHub and loaded manually.

Already installed? Export a backup from **Settings → Capture & data**, replace the files in the existing extension folder, then reload ChatAtlas on the Extensions page.

## Try it

1. **Save a conversation.** Open a ChatGPT conversation or import a chat file in the workspace.
2. **Find the original message.** Search by a word you remember and open the result to read it in context.
3. **Make a project document.** Configure a provider under **Settings → AI connection**, then select conversations to generate a Wiki. Check key claims against the originals and export Markdown, with a separate reference examples file if you need it.

![Searching saved conversations in the ChatGPT sidebar](docs/images/sidecar-chatgpt-light.png)

## Data and supported sources

- Chats and projects stay in your browser. When you use AI organization, the relevant material goes to your chosen provider.
- Import official exports from ChatGPT, Claude, Gemini (Google Takeout JSON), and DeepSeek, or Markdown and JSON files from other platforms.
- ChatGPT supports web history sync. Web capture for Claude, Gemini, DeepSeek, Doubao, Kimi and Qwen (including Qwen international) is in preview and saves loaded messages after site permission is granted.

[User guide](docs/en/GETTING_STARTED.md) · [Privacy](docs/en/PRIVACY.md) · [Local development](docs/en/CONTRIBUTING.md) · [MIT license](LICENSE)
