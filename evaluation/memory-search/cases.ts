/** Hand-labelled synthetic examples, not private histories or a real-user quality claim. */
export const memoryCases = [
  {id:"executor",text:"AI 不再直接修改 Canvas。AI 生成 Operation Plan，确定性执行器执行并校验；失败保留原状态。",queries:["关于 AI 直接修改 Canvas 的方案，后来为什么改了？","之前讨论过一个确定性执行器的方案","结构化执行器","Operation Plan"]},
  {id:"procurement",text:"采购比价暂时不做。前期只提供零件清单；自动采购的维护成本太高，暂缓开发。",queries:["之前我们为什么决定暂时不做采购比价？","实时采购比价","自动采购的原因是什么？","why did we postpone price comparison"]},
  {id:"vision",text:"拍照识别在 Milestone 4，目前是计划，尚未报告实现。识别结果进入零件库。",queries:["视觉识别","之前讨论过一个拍照识别的方案","visual recognition","Milestone 4"]},
  {id:"index",text:"保存搜索索引到本地，避免重开侧栏后再次扫描完整正文。索引持久化保留消息定位。",queries:["索引持久化","之前为什么决定保存搜索索引？","index persistence","在哪里讨论过保存搜索索引"]},
  {id:"collection",text:"上下文收藏保存原文问答的固定快照。用户主动选择复用，不能把历史建议当成当前决定。",queries:["context collection","context bundle","之前讨论过一个上下文收藏的方案","上下文收藏"]},
  {id:"backup",text:"IndexedDB 的本地备份可以导出并恢复，不包含 API 密钥。卸载浏览器扩展前先备份。",queries:["IndexedDB","本地备份","为什么本地备份不包含 API 密钥？","导出并恢复"]},
  {id:"pane",text:"Reader 原文面板支持拖动分隔线调整宽度，手机保持全屏。改变宽度不清空编辑草稿。",queries:["Reader","拖动分隔线","之前为什么决定保留编辑草稿？","原文面板"]},
  {id:"release",text:"V0.1 已在 10 月 12 日正式发布，用户报告已上传扩展包。V0.2 是计划，尚未发布。",queries:["V0.1","V0.2","正式发布","扩展包"]},
] as const;
export const memoryHardCases = [
  {query:"那个看照片就知道要买什么零件的能力",expected:"vision",reason:"Unlisted paraphrase without an exact feature name"},
  {query:"为什么放弃让模型自己动手画硬件",expected:"executor",reason:"Ambiguous metaphor and no exact identifier"},
] as const;
export const memoryNegativeCases = ["不存在的项目 QuartzDB",'"自动采购已经正式发布"',"WeatherStation_ZX900","研究深海鲸鱼迁徙路线"];
