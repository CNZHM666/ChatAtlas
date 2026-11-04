/** Organizational labels only. Matching never confirms a fact or adds a link. */
export const matterTopics=[
 {id:"topic:product",zh:"产品与需求",en:"Product & requirements",terms:[[/产品|需求|定位|用户目标|商业|定价|\bproduct\b|requirements?|positioning/giu,4]]},
 {id:"topic:architecture",zh:"系统架构",en:"Architecture",terms:[[/架构|数据模型|数据流|事务|执行器|接口协议|基础设施|组件依赖/giu,4],[/\bir\b|schema|indexeddb|数据库|持久化/giu,3]]},
 {id:"topic:implementation",zh:"开发实施",en:"Implementation",terms:[[/开发|实施|实现顺序|实施顺序|里程碑|优先级|迭代|排期|mock|implementation|milestone|development/giu,4],[/链路|集成|接入顺序/giu,2]]},
 {id:"topic:models",zh:"模型与算法",en:"Models & algorithms",terms:[[/模型|算法|识别|视觉|catalog|interpreter|llm|推理|路由/giu,4],[/匹配|准确率|阈值/giu,2]]},
 {id:"topic:experience",zh:"界面与交互",en:"Interface & interaction",terms:[[/界面|交互|布局|侧边栏|导航|样式|弹窗|快捷|排版|无障碍/giu,4],[/按钮|预览|拖拽/giu,2]]},
 {id:"topic:verification",zh:"测试与验收",en:"Testing & acceptance",terms:[[/测试|验收|benchmark|通过标准|回归|测试指标|\btests?\b|testing|acceptance|regression/giu,5],[/验证|指标|覆盖率/giu,2]]},
 {id:"topic:access",zh:"接入与安全",en:"Access & security",terms:[[/byok|api\s*key|密钥|权限|认证|隐私|安全|降级|未配置\s*key/giu,5],[/配额|限流|授权/giu,3]]},
 {id:"topic:knowledge",zh:"文档与资料",en:"Documentation & knowledge",terms:[[/文档|wiki|上下文|导出|资料|知识|复习/giu,4],[/引用|来源/giu,2]]},
] satisfies Array<{id:string;zh:string;en:string;terms:Array<[RegExp,number]>}>;

export function matterTopicScores(text:string){
 return matterTopics.map(topic=>({id:topic.id,score:topic.terms.reduce((sum,[pattern,weight])=>sum+(text.match(pattern)?.length?weight:0),0)}));
}
