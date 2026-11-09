import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";
import { sourceQuoteText } from "./source-quote-text";

const parser = unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);
/** Completeness is a presentation guard, not evidence of truth or adoption. */
export function completeProjectIntroduction(value: string): boolean {
  const text = sourceQuoteText(value).trim();
  return text.length > 0 && !/^(?:项目概况|项目介绍|产品定位|历史简介|overview|introduction|summary)[。.!]?$/iu.test(text) && !/[：:、，,;；→\-–—]$/u.test(text)
    && !(/^(?:核心闭环|核心路径|使用闭环|工作流程|core (?:loop|workflow))/iu.test(text)&&/→|->|概括为|consists of/iu.test(text)&&!/(?:是一|定位为|面向|旨在|\b(?:is a|helps?|designed for)\b)/iu.test(text))
    && !/(?:如下|以下|包括|在于|分别为|例如|such as|as follows|including)\s*[：:]?$/iu.test(text)
    && !/成熟度|(?:主观|综合)评分|\b(?:maturity score|subjective rating)\b/iu.test(text);
}

/** Reuse complete positioning paragraphs, including bold introductions. Never
 * take the first arbitrary block or silently truncate a paragraph. */
export function projectIntroductionParagraphs(body: string): string[] {
  return parser.parse(body).children.flatMap(node => {
    if (node.type !== "paragraph" || !node.position) return [];
    const text = body.slice(node.position.start.offset!, node.position.end.offset!).trim();
    return text.length <= 700 && completeProjectIntroduction(text) ? [text] : [];
  });
}

export function introductionPriority(text: string): number {
  const plain = sourceQuoteText(text);
  return Number(/面向|帮助|旨在|用于|致力于|\b(?:helps?|for|aims?|enables?)\b/iu.test(plain)) * 4
    + Number(/通过|提供|生成|整理|\b(?:through|provides?|generates?|organizes?)\b/iu.test(plain)) * 2
    + Number(/(?:本项目|本产品|平台|工作台|工具|系统).{0,45}(?:面向|帮助|旨在|用于)|(?:定位为|被定义为)|\b(?:product|platform|tool)\s+(?:is|for|helps)/iu.test(plain)) * 6
    - Number(/竞品|标杆|竞争对手|\b(?:competitor|benchmark)/iu.test(plain)) * 5
    // A relationship to another product is not what the project itself is.
    - Number(/与\s*[^，。,.]{1,16}?\s*(?:的关系|的分工|相比|对比)|相比于?|不同于|区别于|\b(?:versus|vs\.|compared (?:with|to)|relationship (?:with|to)|instead of)\b/iu.test(plain)) * 8
    - Number(/宣传|营销|推广重点|广告文案|\b(?:wow moment|marketing|promotional|demo video)\b/iu.test(plain)) * 16;
}

/** Overview projection only. Remove a separately attributed implementation
 * suggestion only when complete standalone purpose sentences remain. Never
 * shorten a condition, alter the saved claim or strip its adoption status. */
export function projectPurposeText(text:string):string {
  if(/[`\n]/u.test(text))return text;
  const sentences=text.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))\s*|(?<=\.)\s+(?=[A-Z])/u).filter(Boolean);
  const advice=(sentence:string)=>/^(?:助手|AI|人工智能|the assistant)\s*(?:建议|推荐|提出|suggests?\b|recommends?\b|proposes?\b)/iu.test(sourceQuoteText(sentence).trim())
    && /页面|模块|组件|技术栈|按钮|独立入口|\b(?:page|module|component|stack|button|tab)\b/iu.test(sentence);
  const kept=sentences.filter(sentence=>!advice(sentence));
  if(kept.length===sentences.length||!kept.some(sentence=>completeProjectIntroduction(sentence)&&introductionPriority(sentence)>=4))return text;
  return kept.join(/\p{Script=Han}/u.test(text)?"":" ");
}
