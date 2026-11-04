/** Conventional names for one subject only. No conjunction stripping: two
 * independent subjects require a real directory plan, not a destructive rename. */
export function wikiEditorialTitle(title:string,zh=true):string {
 if(!zh)return title.trim();
 const names:Record<string,string>={
  "technical architecture":"系统架构","system architecture":"系统架构","product positioning":"产品定位","product positioning and scope":"产品定位","release and validation":"发布准备",
  "技术架构与设计":"系统架构","技术架构与数据模型":"系统架构","UI/UX设计与规范":"界面设计","UI/UX设计规范":"界面设计","AI逻辑与生成系统":"AI生成流程","AI逻辑与事务":"AI修改事务","产品战略与定位":"产品定位",
  "产品定位与核心价值":"产品定位","产品定位与价值主张":"产品定位","界面设计与交互体验":"界面设计","系统架构与技术实现":"系统架构","使用流程与工作流":"使用流程"
 };
 return names[title.trim()]??names[title.trim().toLowerCase()]??title.trim();
}
