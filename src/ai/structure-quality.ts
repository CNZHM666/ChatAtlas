export interface StructureQuality {
  duplicateChapters: string[][];
  overSegmented: boolean;
  genericTitles: string[];
  questionLikeTitles: string[];
  tooManyRelations: boolean;
  tooManyBridges: boolean;
  poorCompression: boolean;
  missingMajorStage: boolean;
  compressionRatio: number;
  accepted: boolean;
}

const generic = /^(其他|杂项|学习研究|继续讨论|阶段主题|阶段主题梳理|一些问题|问题|这个怎么做|继续|other|misc|general|continued discussion)$/iu;
const questionLike = /[？?]$|^(你|我|我们|这个|那个|有没有|能不能|是否|如何|怎么|为什么|请问|可以|能否)/u;

function semanticTitleKey(title: string): string {
  return title.trim().toLocaleLowerCase()
    .replace(/canvas\s*结构/giu, "canvas架构")
    .replace(/编程实现/gu, "工程实现")
    .replace(/自动分章|智能整理/gu, "自动整理")
    .replace(/[\s·—_\-与和及、，,:：]/gu, "")
    .replace(/(相关|主题|方案)$/u, "");
}

export function evaluateStructureQuality(input: {
  questionCount: number;
  chapterTitles: string[];
  relationCount: number;
  bridgeCount: number;
  coveredQuestionCount: number;
}): StructureQuality {
  const chapterCount = input.chapterTitles.length;
  const compressionRatio = input.questionCount ? chapterCount / input.questionCount : 0;
  const genericTitles = input.chapterTitles.filter((title) => generic.test(title.trim()));
  const questionLikeTitles = input.chapterTitles.filter((title) => questionLike.test(title.trim()));
  const duplicateChapters = input.chapterTitles.slice(1).flatMap((title, index) =>
    semanticTitleKey(input.chapterTitles[index]) === semanticTitleKey(title) ? [[input.chapterTitles[index], title]] : []);
  const overSegmented = input.questionCount >= 8 && (chapterCount > 9 || compressionRatio > .55);
  const poorCompression = input.questionCount >= 10 && compressionRatio > .45;
  const tooManyRelations = input.relationCount > Math.max(4, chapterCount * 2);
  const tooManyBridges = input.bridgeCount > Math.max(2, Math.floor(input.relationCount / 3));
  const missingMajorStage = input.coveredQuestionCount !== input.questionCount;
  return { duplicateChapters, overSegmented, genericTitles, questionLikeTitles, tooManyRelations, tooManyBridges, poorCompression, missingMajorStage, compressionRatio, accepted: !duplicateChapters.length && !overSegmented && !poorCompression && !genericTitles.length && !questionLikeTitles.length && !tooManyRelations && !tooManyBridges && !missingMajorStage };
}
