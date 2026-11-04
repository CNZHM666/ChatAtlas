import { expect, it, vi } from "vitest";
import { claimRange, derivedSentenceRanges, paintClaimHighlights, paintHolderRuns, similarSentenceRanges } from "./claim-highlight";

it("locates the selected formulation across inline formatting instead of borrowing the last semicolon clause", () => {
  const root = document.createElement("div");
  root.innerHTML = '<ul><li><strong>连线颜色：</strong>连接线默认<strong>中性灰</strong>，选中为强调色，Error 为红色；V0.1 保持静态，不大量动画。<button class="wiki-claim-marker" data-claim-key="edge:0"></button></li></ul>';
  const [range] = paintClaimHighlights(root, ["edge:0"], () => ["连接线默认中性灰"]);
  expect(range.toString()).toBe("连接线默认中性灰");
  const [next] = paintClaimHighlights(root, ["edge:0"], () => ["V0.1 保持静态，不大量动画。"]);
  expect(next.toString()).toBe("V0.1 保持静态，不大量动画。");
  expect(paintClaimHighlights(root, ["edge:0"], () => ["正文完全没有这一句结论"])).toEqual([]);
});

it("uses the occurrence next to its own marker when identical phrases repeat in one paragraph", () => {
  const root = document.createElement("div");
  root.innerHTML = '<p>连接线默认中性灰。<button class="wiki-claim-marker" data-claim-key="old"></button>其他内容。连接线默认中性灰。<button class="wiki-claim-marker" data-claim-key="new"></button></p>';
  const [range] = paintClaimHighlights(root, ["new"], () => ["连接线默认中性灰"]);
  expect(range.startContainer).toBe(root.querySelector("p")!.childNodes[2]);
});

it("highlights the sentence before a claim marker, from the last sentence end or previous marker", () => {
  const root = document.createElement("div");
  root.innerHTML = '<p>开场说明。首页只保留搜索入口<button class="wiki-claim-marker" data-claim-key="s:0"></button>，导入放到次要区域。<button class="wiki-claim-marker" data-claim-key="s:1"></button></p>';
  document.body.append(root);
  const [first, second] = [...root.querySelectorAll<HTMLElement>(".wiki-claim-marker")];
  expect(claimRange(first)?.toString()).toBe("首页只保留搜索入口");
  expect(claimRange(second)?.toString()).toBe("，导入放到次要区域。");
  const ranges = paintClaimHighlights(root, ["s:1"]);
  expect(ranges).toHaveLength(1);
  expect(second.hasAttribute("data-claim-highlighted")).toBe(true);
  expect(first.hasAttribute("data-claim-highlighted")).toBe(false);
  paintClaimHighlights(root, []);
  expect(second.hasAttribute("data-claim-highlighted")).toBe(false);
  root.remove();
});

it("finds the sentences closest in wording to an original, and none for unrelated text", () => {
  const root = document.createElement("div");
  root.innerHTML = "<p>首版面向 ESP32，支持需求输入和方案预览。自动下单留到以后再做。</p><p>界面采用浅色主题。</p>";
  document.body.append(root);
  expect(similarSentenceRanges(root, "首版先面向 ESP32，支持需求输入、方案预览与校验。").map(range => range.toString())).toEqual(["首版面向 ESP32，支持需求输入和方案预览。"]);
  expect(similarSentenceRanges(root, "完全无关的一句话，讲的是天气和午饭。")).toEqual([]);
  root.remove();
});

const numericBranches='<p>如果：</p><p><strong>5～8个人</strong></p><p>主动继续玩，我认为值得继续开发。</p><p>如果：</p><p><strong>10个人以上</strong></p><p>明显愿意做自己的硬件项目：</p><p>那你就应该非常认真地做下去。</p>';
it("joins a short numeric condition and its predicate, without borrowing the previous branch",()=>{
 const root=document.createElement('div');root.innerHTML=numericBranches;
 const ranges=derivedSentenceRanges(root,['若 10 人以上明显愿意做项目。']);
 expect(ranges).toHaveLength(1);
 expect(ranges[0].toString()).toBe('10个人以上明显愿意做自己的硬件项目：');
 expect(ranges[0].toString()).not.toContain('5～8');
 expect(ranges[0].toString()).not.toContain('认真地做下去');
});

it.each(['20个人以上','10个人以下','超过10个人','10天以上'])("refuses matching prose under an incompatible condition: %s",label=>{
 const root=document.createElement('div');root.innerHTML=numericBranches.replace('10个人以上',label);
 expect(derivedSentenceRanges(root,['若 10 人以上明显愿意做项目。','明显愿意做自己的硬件项目：'])).toEqual([]);
});

it("keeps the range branch separate and never joins across a new if, heading or source message",()=>{
 const root=document.createElement('div');root.innerHTML=numericBranches;
 const matched=derivedSentenceRanges(root,['若 5-8 人主动继续玩，值得继续开发。']);
 expect(matched).toHaveLength(1);expect(matched[0].toString()).toBe('5～8个人主动继续玩，我认为值得继续开发。');
 for(const separator of ['<p>如果：</p>','<h2>另一个方案</h2>','<hr>']){
  root.innerHTML='<p><strong>10个人以上</strong></p>'+separator+'<p>明显愿意做自己的硬件项目：</p>';
  expect(derivedSentenceRanges(root,['若10人以上明显愿意做项目。'])).toEqual([]);
 }
 root.innerHTML='<section><p><strong>10个人以上</strong></p></section><section><p>明显愿意做自己的硬件项目：</p></section>';
 expect(derivedSentenceRanges(root,['若10人以上明显愿意做项目。'])).toEqual([]);
});

it("does not treat an unrelated predicate as evidence just because its numeric label matches",()=>{
 const root=document.createElement('div');root.innerHTML='<p><strong>10个人以上</strong></p><p>已经选择放弃项目，准备取消开发。</p>';
 expect(derivedSentenceRanges(root,['若10人以上明显愿意做项目。'])).toEqual([]);
});

it("matches a priority summary to its whole numbered code passage, across syntax spans",()=>{
 const root=document.createElement("div");
 root.innerHTML='<p>与本条无关的其他建议。</p><pre><code>本轮修改优先级：\n\n1. <span>Beginner Journey</span> 是否自然\n2. Welcome / Discovery / Solution Draft 是否足够简单\n3. 是否复用现有底层系统\n4. 是否保持当前 Workspace 稳定\n5. 最后才是视觉装饰\n\n永远选择更简单。</code></pre>';
 const ranges=derivedSentenceRanges(root,["Beginner Journey 自然度 > 界面简单性 > 复用底层系统 > 保持 Workspace 稳定 > 视觉装饰。"]);
 expect(ranges).toHaveLength(1);
 expect(ranges[0].toString()).toContain("1. Beginner Journey 是否自然");
 expect(ranges[0].toString()).toContain("5. 最后才是视觉装饰");
 expect(ranges[0].toString()).not.toContain("永远选择更简单");
 expect(ranges[0].startContainer.parentElement?.closest("pre")).toBeTruthy();
 expect(derivedSentenceRanges(root,["天气晴朗，今天去公园散步，晚上回家吃饭。"])) .toEqual([]);
});

it("finds a vertical flow whose individual code lines are too short to match",()=>{
 const root=document.createElement("div");
 root.innerHTML='<blockquote><p><strong>从“我想做什么”，一直陪你到“我真的把它做出来”。</strong></p></blockquote><pre><code>想法\n↓\n设计\n↓\n校验\n↓\n已有零件\n↓\n缺少零件\n↓\n比价购买\n↓\n接线\n↓\n代码</code></pre>';
 const ranges=derivedSentenceRanges(root,["完整的核心链路从想法开始，涵盖设计、校验、缺少零件识别、比价购买及接线代码。"]);
 expect(ranges[0].startContainer.parentElement?.closest("pre")).toBeTruthy();
 expect(ranges[0].toString()).toContain("设计\n↓\n校验");
 expect(ranges[0].toString()).toContain("接线\n↓\n代码");
});

it("marks a close sentence whole even when bold text splits it", () => {
  const root = document.createElement("div");
  root.innerHTML = "<p>我认为结构已经完整。其中对话库应该类似于 <strong>AI 对话的文件管理器</strong>，而不是又一个聊天机器人。</p>";
  document.body.append(root);
  expect(similarSentenceRanges(root, "AI建议对话库应定位为类似 AI 对话的文件管理器，而非又一个聊天机器人。").map(range => range.toString())).toEqual(["其中对话库应该类似于 AI 对话的文件管理器，而不是又一个聊天机器人。"]);
  root.remove();
});

it("finds the original sentence a short conclusion was drawn from, inside a long reply", () => {
  const root = document.createElement("div");
  root.innerHTML = "<p>关于存储，我建议第一版所有数据都只保存在本地 IndexedDB 里，不上传到任何服务器，这样隐私风险最小，之后再考虑可选的云同步。界面颜色以后再说。</p>";
  document.body.append(root);
  expect(similarSentenceRanges(root, "首版数据仅存本地 IndexedDB，不上传服务器。").map(range => range.toString())).toEqual(["关于存储，我建议第一版所有数据都只保存在本地 IndexedDB 里，不上传到任何服务器，这样隐私风险最小，之后再考虑可选的云同步。"]);
  root.remove();
});

it("matches English sentences by words and keeps the looser bar for known sources", () => {
  const root = document.createElement("div");
  root.innerHTML = "<p>We could start with a local index. Search results would then be ranked by recency and topic. The logo is blue.</p>";
  document.body.append(root);
  expect(similarSentenceRanges(root, "Results are ranked by recency and topic.").map(range => range.toString())).toEqual(["Search results would then be ranked by recency and topic."]);
  expect(similarSentenceRanges(root, "The weather is nice today.")).toEqual([]);
  expect(similarSentenceRanges(root, "Start from a local index.")).toEqual([]);
  expect(derivedSentenceRanges(root, ["Start from a local index."]).map(range => range.toString())).toEqual(["We could start with a local index."]);
  root.remove();
});

it("finds an English original for a Chinese conclusion by the names and numbers they share, for a known source only", () => {
  const root = document.createElement("div");
  root.innerHTML = "<p>Messages are stored in IndexedDB and indexed with Orama for full-text search. The sidebar opens on the right.</p>";
  document.body.append(root);
  expect(similarSentenceRanges(root, "消息保存在 IndexedDB，并用 Orama 建立全文索引。")).toEqual([]);
  expect(derivedSentenceRanges(root, ["消息保存在 IndexedDB，并用 Orama 建立全文索引。"]).map(range => range.toString())).toEqual(["Messages are stored in IndexedDB and indexed with Orama for full-text search."]);
  root.remove();
});

it("tints the text each holder mark covers, back to the previous mark, and clears it when hidden", () => {
  const marks = new Map<string, { ranges: Range[] }>();
  vi.stubGlobal("CSS", { highlights: { set: (name: string, value: { ranges: Range[] }) => marks.set(name, value), delete: (name: string) => marks.delete(name) } });
  vi.stubGlobal("Highlight", class { ranges: Range[]; priority = 0; constructor(...ranges: Range[]) { this.ranges = ranges; } });
  const root = document.createElement("div");
  root.innerHTML = '<p>前言没有标记。<button class="wiki-claim-marker is-holder is-holder-ai"></button>第一版只做导入。<button class="wiki-claim-marker is-holder is-holder-open"></button>首页只留<strong>搜索</strong>。<button class="wiki-claim-marker is-holder is-holder-material"></button>尾巴没有标记。</p>';
  document.body.append(root);
  expect(paintHolderRuns(root, true)).toBe(2);
  // The assistant's run, the default, is not tinted; a status run is, back to the previous mark.
  expect(marks.has("atlas-holder-ai")).toBe(false);
  expect(marks.get("atlas-holder-open")!.ranges.map(range => range.toString())).toEqual(["第一版只做导入。"]);
  expect(marks.get("atlas-holder-material")!.ranges.map(range => range.toString())).toEqual(["首页只留搜索。"]);
  paintHolderRuns(root, false);
  expect(marks.size).toBe(0);
  root.remove(); vi.unstubAllGlobals();
});

it("marks an original's heading when that is where the reply makes the point, and only for the original", () => {
  const root = document.createElement("div");
  root.innerHTML = "<h2>七、它有什么缺点？为什么 Atlas 不适合直接照搬？</h2><p>我觉得有三个非常重要的区别。</p><h3>1. Mem0 擅长记忆召回，但 Atlas 需要管理项目的「现行状态」</h3><p>假设先后发生两次讨论：</p>";
  document.body.append(root);
  const claim = "Mem0 擅长持续交互中的记忆召回，但不适合直接照搬至 Atlas，因为 Atlas 需要管理项目现行状态。";
  expect(derivedSentenceRanges(root, [claim]).map(range => range.toString())).toContain("Mem0 擅长记忆召回，但 Atlas 需要管理项目的「现行状态」");
  // The Wiki's own headings are never marked for a sentence of its prose.
  expect(similarSentenceRanges(root, claim)).toEqual([]);
  root.remove();
});
