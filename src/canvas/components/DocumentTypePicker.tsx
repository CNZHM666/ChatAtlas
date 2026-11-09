import { useState } from "react";
import { chooseDocumentType, chosenDocumentType, LEARNING_BETA, type WikiDocumentTypeChoice } from "../../shared/wiki-document-type";

const CHOICES: Array<[WikiDocumentTypeChoice, string, string, string, string]> = [
  LEARNING_BETA ? ["auto", "自动", "Auto", "按项目整理（学习模式测试中，需要时请手动选择）", "Organize as a project (learning is in beta: choose it yourself)"] : ["auto", "自动", "Auto", "按对话内容判断是项目还是学习", "Decide from the conversations"],
  ["project", "项目", "Project", "按项目整理：决定、范围、未决问题", "Organize as a project: decisions, scope, open questions"],
  ["learning", LEARNING_BETA ? "学习（测试中）" : "学习", LEARNING_BETA ? "Learning (beta)" : "Learning", "按学习整理：学会了什么、错误与纠正、待学。测试中，结果可能不稳定", "Organize as learning: what you learned, mistakes, what is next. In beta: results may vary"],
];

/** How the next document is organized, chosen before it is: changing it afterwards means organizing again. Kept for the
 * next run. */
export function DocumentTypePicker({ zh }: { zh: boolean }) {
  const [choice, setChoice] = useState<WikiDocumentTypeChoice>(chosenDocumentType);
  return <div className="document-type-picker" role="radiogroup" aria-label={zh ? "整理类型" : "Document type"}>
    {CHOICES.map(([value, cn, en, hintCn, hintEn]) => <button key={value} type="button" role="radio" aria-checked={choice === value} aria-label={zh ? cn : en} title={zh ? hintCn : hintEn}
      onClick={() => { setChoice(value); chooseDocumentType(value); }}>{zh ? cn : en}</button>)}
  </div>;
}
