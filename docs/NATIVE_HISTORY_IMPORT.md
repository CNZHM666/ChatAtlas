# 多 AI 账号历史导入

网页导入与文件导入保留两个入口。网页入口检测当前浏览器的受支持站点：一个来源直接开始，多个来源由用户多选，没有来源时提示打开并登录网站。同平台多个标签合并；千问国内站与 Qwen 国际站、Gemini 的不同账号槽位分开。

## 实现边界

- `shared/native-import.ts`：平台来源、分页和传输契约。
- `shared/native-import-sources.ts`：发现来源，不读取正文、不调用模型。
- `background/native-history-transport.ts`：在选定标签页的 MAIN world 发起白名单内的只读请求；登录凭据不返回、不持久化、不记录日志。千问国内站请求其原生 API 域名。
- `sync/native-history-adapter.ts`：各平台的列表、正文、消息角色与顺序归一化。修改网页协议时集中维护这里，并检查传输层白名单。
- `sync/doubao-history.ts`：豆包 IM 响应包裹、错误码、布尔分页标记与 int64 解析。列表游标与正文锚点在请求中发送为精确数字 JSON token；响应中的字符串大整数不经 `Number` 转换。正文翻页使用 `index_in_conv`。
- `sync/native-import-runner.ts`：所有平台共用持久任务、分页检查点、增量判断、限流重试、暂停、恢复、错误报告和成功批次保存。
- `canvas/hooks/useImportCommands.ts` 与 `NativeImportDialog.tsx`：入口分流与用户选择。旧 ChatGPT 任务继续兼容；新入口使用统一任务。

任务仍使用原有 `chatgpt-history` 存储键，以 `ImportJob.native.version` 区分新引擎，避免两个引擎同时写同一状态。不要因为该兼容键名称而把新任务当作 ChatGPT 专用任务。

## 当前协议实现

| 平台 | 列表 | 正文 |
| --- | --- | --- |
| ChatGPT | offset，活动与归档两组 | conversation mapping 当前分支 |
| Claude | 工作区组织列表、各组织 offset | chat_messages，经已有 Claude 解析器处理 |
| Gemini | MaZiqc continuation | hNvQHb continuation，按问答回合恢复顺序 |
| DeepSeek | updated_at cursor | history_messages 当前分支，保留 REQUEST / RESPONSE / TEMPLATE_RESPONSE |
| Kimi | FeedService/ListFeeds continuation | ChatService/ListMessages continuation |
| 千问国内站 | session/page/list next_token | session/msg/list pos |
| Qwen 国际站 | chats page | chat/history mapping 或 messages |
| 豆包 | recent_conv next_conv_version | single 消息链 anchor_index |

这些是网页私有协议实现，新增实现尚未经过用户真实账号逐站验收。协议字段变化、账号身份无法确认、重复游标、缺失正文或达到分页预算都会报错，不能降级为“完整导入成功”。现有的已加载网页采集继续存在，且不等同于账号历史导入。

“完整正文”针对接口提供的可读消息和当前分支；当前实现不下载附件二进制，也不恢复已删除、无权限或未保存的记录。项目、归档、固定对话是否被平台列表接口完整覆盖，必须在真实账号验收中核对；不能仅凭分页结束宣称所有隐藏入口均已覆盖。

## 增量与恢复

1. 每次重新导入重新遍历列表，不因出现旧标题而停止；旧对话也可能刚被修改。
2. 用平台更新时间与已读取版本比较。缺少可靠时间、仅有局部正文或未保存正文时，进入待同步队列。
3. 正文所有分页解析成功才替换当前保存正文，并保留来源历史版本；失败保留旧正文。
4. 网页 DOM 后续采集继续合并，保留未加载的旧消息，并保护原生来源绑定；检测到新增或修改时完整性标记回到 loaded。
5. 账号标识只保存本地哈希。能从登录令牌读取稳定用户标识时使用用户标识；只有不透明会话值时绑定当前登录会话，重新登录后可能需要重新核对来源。
6. 每页、每个正文保存后写检查点。服务进程重启时将未完成任务恢复为暂停，由用户点击继续；重新打开同一来源标签后可重绑定标签 ID，账号仍需一致。
7. 多平台逐源执行，单源失败保留其他成功批次；正文最多 4 条并发，同一来源最多 2 条，单条对话内的分页仍顺序读取；出现限流或网络故障后该来源降为 1 条，网络与限流最多重试两次。进度快照按写入顺序持久化。
8. 普通导入不调用 AI、不自动扩大项目材料范围、不自动改写项目文档。
9. 运行中点击「优先同步」将所选对话移到尚未开始的队列前方，保留已发出的请求且不重复读取。新来源有空闲并发位时立即唤醒调度；进度通过 `activeIds` / `priorityPendingIds` 区分正在读取与优先排队。

## 验收

逐站核对：超出一页的历史、最早一条历史、长对话、多轮回答、固定/归档/项目内记录、Google 多账号、工作区切换、登录失效、正文修改、再次导入、中断继续、重复分页和失败重试。用原站或官方导出作对照，确认平台特有的隐藏入口覆盖情况。

协议研究参考：各平台网页实际使用的接口；公开协议线索包括 [agent-tincan](https://github.com/mvanhorn/agent-tincan)、[OpenCLI](https://github.com/jackwener/OpenCLI)、[DeepSeek backup](https://github.com/Map9876/DeepSeek-backup-web)。公开资料不能代替登录账号验收。

DeepSeek 正文按 `chat_session.current_message_id` 回溯当前分支，读取 `RESPONSE` 和 `TEMPLATE_RESPONSE`；未选中的空分支不阻止当前分支同步。原站公开前端协议参考：https://fe-static.deepseek.com/chat/static/main.d1d163b7e4.js 。

同步勾选继续保存在旧的 `atlas-workbench-selected-conversations`；用户确认的整理材料保存在独立的 `atlas-workbench-project-sources`，不从旧同步勾选自动迁移。点击「用于本次整理」才带入输入区，清空材料不影响同步勾选。
