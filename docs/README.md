# ChatAtlas 文档目录

**简体中文** · [English](en/README.md)

以下是当前维护文档，入口、限制和费用行为以这些说明为准。

对话文件导入支持 ChatGPT、Claude、Gemini（Google Takeout JSON）和 DeepSeek 的官方导出，以及其他 AI 的 Markdown／JSON 对话记录。Claude、Gemini、DeepSeek、豆包、Kimi、通义千问（含 Qwen 国际站）提供网页适配试用：浏览器授予网站权限后默认自动运行，可在设置中暂停或恢复；支持原生侧栏、本地查找、项目关联、已加载消息同步、原文定位和输入框填入。网页历史导入读取已加载标题并逐条保存已加载正文；仅保存当前已加载的消息，不保证完整历史。ChatGPT 保留专用历史列表与正文同步。新增适配尚未经登录网站逐一验收；BYOK 模型服务商与对话来源平台相互独立。

| 文档 | 内容 |
| --- | --- |
| [使用指南](GETTING_STARTED.md) | 安装后首次使用、来源导入、项目与侧栏 |
| [上下文打包与精炼](CONTEXT.md) | 本地打包、章节选择、AI 精炼与还原 |
| [隐私说明](PRIVACY.md) | 本地存储、服务商请求、权限与备份 |
| [首版范围](FIRST_RELEASE_OVERVIEW.md) | 已开放、实验和暂未开放的能力 |
| [发布清单](RELEASE_CHECKLIST.md) | 自动检查、真实验收、打包与 GitHub 准备 |
| [依赖声明](THIRD_PARTY_NOTICES.md) | 运行时依赖和许可证 |
| [上下文模板](examples/project-context-template.md) | 不含私人材料的可手动填写模板 |
| [架构](../ARCHITECTURE.md) | 目录、数据与链路职责 |
| [AI 工作流](../AI_WORKFLOWS.md) | 模型调用、缓存、预算与验证边界 |
| [产品准则](../PRODUCT_PRINCIPLES.md) | 统一产品取舍 |
| [贡献指南](../CONTRIBUTING.md) | 开发、检查与反馈 |
| [更新记录](../CHANGELOG.md) | 当前预览版的变化 |

以上维护指南都有对应英文版，可从各文档顶部切换。依赖声明和许可证共用原文，不翻译法律文本。

本机 `docs/archive/` 保留历史实现记录和旧稿，旧截图及诊断也只在本地保留；不属于公开源码清单，不用其中的旧状态覆盖当前说明。新增文档按用途加入此目录，而非在根目录持续堆叠诊断报告。
