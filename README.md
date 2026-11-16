# ChatAtlas

[English](README.en.md) · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/CNZHM666/ChatAtlas/issues)

把聊过的 AI 对话存下来，随时搜回原话。也可以把长讨论整理成带来源的项目 Wiki，交给同事或另一个 AI 继续用。

**搜索和阅读不需要 API Key。** AI 整理使用你自己配置的服务商。

## 安装到 Chrome 或 Edge

**[下载 ChatAtlas 安装包（ZIP）](https://github.com/CNZHM666/ChatAtlas/releases/download/v0.1.4/ChatAtlas-extension-v0.1.4.zip)** · [查看版本发布页](https://github.com/CNZHM666/ChatAtlas/releases/tag/v0.1.4)

1. 下载 ZIP，解压到一个以后还会保留的文件夹。
2. 在浏览器地址栏输入 **Chrome** 的 `chrome://extensions` 或 **Edge** 的 `edge://extensions`，打开「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择刚解压出来的文件夹。选对后，文件夹里能看到 `manifest.json`。

安装后，从浏览器的扩展菜单打开 **ChatAtlas**。两个浏览器使用同一个安装包。现阶段通过 GitHub 提供早期预览版，需要手动加载。

已安装旧版？先在「设置 → 采集与数据」导出备份，再用新版文件替换原安装目录中的文件，最后在扩展页刷新 ChatAtlas。

## 第一次用

1. **保存一段对话。** 打开一条 ChatGPT 对话，或在工作台导入聊天记录。
2. **搜回原话。** 用记得的关键词搜标题或正文，点开结果查看完整问答。
3. **整理成文档。** 在「设置 → AI 连接」配置服务商后，选中对话生成项目 Wiki。核对关键结论和原文后，可以导出 Markdown，也可以单独导出参考示例。

![在 ChatGPT 侧栏搜索已保存的对话](docs/images/sidecar-chatgpt-light.png)

## 数据与支持范围

- 对话和项目存在当前浏览器。使用 AI 整理时，相关材料会发给你选择的服务商。
- 支持导入 ChatGPT、Claude、Gemini（Google Takeout JSON）和 DeepSeek 的导出文件，也能导入其他平台的 Markdown 或 JSON 记录。
- ChatGPT 支持网页历史同步。Claude、Gemini、DeepSeek、豆包、Kimi 和通义千问（含 Qwen 国际站）的网页采集处于试用阶段，获得网站权限后会保存已加载的消息。

[使用指南](docs/GETTING_STARTED.md) · [隐私说明](docs/PRIVACY.md) · [本地开发](CONTRIBUTING.md) · [MIT 许可](LICENSE)
