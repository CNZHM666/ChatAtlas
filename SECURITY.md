# 安全策略 · Security Policy

**简体中文** · [English](#english)

## 支持的版本

ChatAtlas 仍处于早期开发阶段，只为最新发布的 0.1.x 版本修复安全问题。旧版本请先升级再确认问题是否仍然存在。

## 报告漏洞

**请不要在公开 Issue、讨论或 Pull Request 中报告安全问题。**

请通过 GitHub 的私密漏洞报告提交：打开仓库的 **Security → Report a vulnerability**。报告中请说明：

- 受影响的版本、浏览器和操作系统；
- 问题类型与影响（例如 API Key 泄露、跨站读取对话、扩展页面被外部网站利用）；
- 最小复现步骤或概念验证。请使用虚构材料，不要附上真实 API Key、私人对话或未经脱敏的诊断文件。

我们会在 7 天内确认收到，并在评估后告知处理计划。修复发布前请不要公开细节；修复发布后，如你愿意，我们会在更新记录中致谢。

## 范围

属于本策略范围的问题包括：

- 扩展存储的 API Key、对话或备份被其他网站、扩展或页面读取；
- 内容脚本、侧栏或工作台页面被外部网页注入、嵌入或冒用；
- 请求被发往用户未选择的服务商或地址；
- 本地导入、导出或备份文件可被构造为执行代码。

不属于范围的问题：用户自己选择的 AI 服务商如何处理收到的数据；需要已经控制用户电脑或浏览器配置才能利用的问题；第三方 AI 网站自身的漏洞。

## 数据说明

ChatAtlas 是本地优先的扩展：对话、项目和 API 配置保存在当前浏览器，没有 ChatAtlas 服务器。只有在你主动调用 AI 时，相关材料才会直接发往你选择的服务商。详见[隐私说明](docs/PRIVACY.md)。

---

## English

### Supported versions

ChatAtlas is in early development. Security fixes are made only for the latest released 0.1.x version. Please upgrade and check that the problem still occurs before reporting it.

### Reporting a vulnerability

**Please do not report security problems in public issues, discussions or pull requests.**

Use GitHub's private vulnerability reporting: open the repository's **Security → Report a vulnerability**. Please include:

- the affected version, browser and operating system;
- the kind of problem and its impact (for example an exposed API key, another site reading saved conversations, or an extension page abused by an outside website);
- minimal steps to reproduce or a proof of concept. Use made-up material; do not attach real API keys, private conversations or unredacted diagnostic files.

We will acknowledge your report within 7 days and tell you the plan once it has been assessed. Please keep the details private until a fix is released; with your permission, we will credit you in the changelog.

### Scope

In scope:

- API keys, conversations or backups stored by the extension being read by another website, extension or page;
- content scripts, the side panel or the workspace page being injected into, embedded or impersonated by an outside page;
- requests sent to a provider or address the user did not choose;
- import, export or backup files that can be crafted to run code.

Out of scope: how an AI provider you chose handles the data it receives; problems that require prior control of your computer or browser profile; vulnerabilities in third-party AI websites themselves.

### Data

ChatAtlas is local-first: conversations, projects and API settings stay in your browser, and there is no ChatAtlas server. Material is sent only when you ask AI to work on it, and then directly to the provider you chose. See the [privacy notes](docs/PRIVACY.md).
