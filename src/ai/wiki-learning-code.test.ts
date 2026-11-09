import { describe, expect, it } from "vitest";
import type { CoverageMaterial } from "./focus-coverage";
import type { WikiKnowledgeLedger } from "../shared/wiki-knowledge";
import { wikiLedgerUnits } from "../shared/wiki-knowledge";
import { keptLearnerCode, LEARNER_CODE_BATCH, ownCode, quotedCode, setTasks, withLearnerCode } from "./wiki-learning-code";
import { heuristicLearningRole } from "./wiki-learning";

const material = (index: number, role: "user" | "assistant", text: string): CoverageMaterial => ({ id: `e${index}`, role, conversationId: "c", sourceConversationIds: ["c"], title: "t", messageId: `m${index}`, messageIndex: index, text: `${role}: ${text}`, rawEvidenceIds: [] });
const empty = (documentType: "learning" | "project"): WikiKnowledgeLedger => ({ version: 1, generatedAt: 1, status: "complete", materials: 0, batches: [], documentType });

describe("the learner's own code", () => {
  it("reads code the learner typed, fenced or not, and leaves outputs and plain questions alone", () => {
    expect(ownCode("第三题我这样写对吗\nvoltage = 7\nif voltage > 10:\n    print(\"High\")\nelse:\n    print(\"Normal\")")).toEqual([{ code: { language: "python", text: "voltage = 7\nif voltage > 10:\n    print(\"High\")\nelse:\n    print(\"Normal\")" }, said: "第三题我这样写对吗", quote: "voltage = 7\nif voltage > 10:\n    print(\"High\")\nelse:\n    print(\"Normal\")" }]);
    expect(ownCode("写好了：\n```python\ndef check(v):\n    return v > 3\n```")[0].code).toEqual({ language: "python", text: "def check(v):\n    return v > 3" });
    expect(ownCode("如果我想加两个元素有没有方便的写法")).toEqual([]);
    expect(ownCode("输出是\n```\nNormal\n```")).toEqual([]);
  });

  it("reads code the AI quotes back as the learner's, never the AI's own version", () => {
    expect(quotedCode("第三题的问题在这里：\n\n```python\nelif voltage > 5:\n    print(\"Low\")\n```\n\n我原来的要求是")).toEqual([{ code: { language: "python", text: "elif voltage > 5:\n    print(\"Low\")" }, said: "第三题的问题在这里", quote: "第三题的问题在这里：\n```python\nelif voltage > 5:\n    print(\"Low\")\n```", review: { said: "我原来的要求是" } }]);
    expect(quotedCode("你最后这一句：\n\n```python\nprint(f\"{sensor['name']}: {result}\")\n```")[0].said).toBe("你最后这一句");
    expect(quotedCode("更准确应该是：\n\n```python\nif voltage >= 3 and voltage <= 10:\n    print(\"Normal\")\n```")).toEqual([]);
    expect(quotedCode("你的错误代码居然也会输出：\n\n```text\nNormal\n```")).toEqual([]);
    expect(quotedCode("比如：\n\n```python\nfor v in voltages:\n    print(v)\n```")).toEqual([]);
    // A task's data, or a case to suppose, is the AI's, even naming an exercise.
    expect(quotedCode("如果第三题：\n\n```python\nvoltages = [2, 5, 12, 7]\nprint(voltages)\n```")).toEqual([]);
    expect(quotedCode("第三题的数据如下：\n\n```python\nvoltages = [2, 5, 12, 7]\nprint(voltages)\n```")).toEqual([]);
    // Values set and nothing done with them are a task's data; a wrong assignment the learner wrote is still theirs.
    expect(quotedCode("第一题：\n\n```python\nage = 20\nhas_ticket = True\n```")).toEqual([]);
    expect(quotedCode("你写的是：\n\n```python\ncontroller = {\"kp\": 2.0}\n\"kp\" = 3.0\n```")).toHaveLength(1);
  });

  it("reads the task each exercise answers, as the AI set it, by its number", () => {
    const set = "第二题：写一个判断，温度大于 30 输出 Hot。\n\n第三题，最重要：\n\n```python\nvoltage = 7\n```\n\n规则：\n\n> 如果电压在 3 到 10 之间，输出 `Normal voltage`；否则输出 `Abnormal voltage`。\n\n你自己写完发给我。";
    const tasks = setTasks(set);
    expect(tasks.get(3)).toEqual({ said: "如果电压在 3 到 10 之间，输出 `Normal voltage`；否则输出 `Abnormal voltage`。", code: { language: "python", text: "voltage = 7" } });
    expect(tasks.get(2)).toEqual({ said: "写一个判断，温度大于 30 输出 Hot。" });
    // A rule given as a block under "规则：" is the task; how to hand it in is not.
    expect(setTasks("第二题：\n\n```python\ntemperature = 35\n```\n\n规则：\n\n```text\n>= 30      Hot\n>= 20      Normal\n其他        Cold\n```\n\n你自己写完发给我。 如果这三题能独立写出来，这一课就算过关。").get(2))
      .toEqual({ said: ">= 30 Hot；>= 20 Normal；其他 Cold", code: { language: "python", text: "temperature = 35" } });
    // Values in a text block show what not to write, not the task's data.
    expect(setTasks("第一题：\n\n```text\nname = \"Robot1\"\nspeed = 50\n```\n\n注意要求你从字典中取，不要重新写三个变量。").get(1)).toEqual({ said: "注意要求你从字典中取，不要重新写三个变量。" });
    // A review naming an exercise sets none.
    expect(setTasks("第三题的问题在这里：\n\n```python\nelif voltage > 5:\n    print(\"Low\")\n```").size).toBe(0);
    const materials = [material(46, "assistant", set), material(47, "user", "第三题：\n```python\nif voltage > 3 and voltage < 10:\n    print(\"Normal voltage\")\n```"), material(48, "assistant", "你写的是：\n\n```python\nif voltage > 3 and voltage < 10:\n```\n\n而题目要求是 3 到 10 之间。")];
    const units = wikiLedgerUnits(withLearnerCode(empty("learning"), materials, true));
    expect(units).toHaveLength(1);
    expect(units[0].evidence.task?.said).toContain("如果电压在 3 到 10 之间");
  });

  it("takes the number from the line over a bare cue, ending the review before it there", () => {
    const review = "第二题：\n\n```python\nif temperature > 35 or pressure > 150:\n    print(\"Warning\")\n```\n\n也完全正确。\n\n第三题逻辑基本对，但有一个细节：\n\n你写的是：\n\n```python\nif voltage > 3 and voltage < 10:\n    print(\"Normal\")\n```\n\n而题目要求是 3 到 10 之间。";
    const [second, third] = quotedCode(review);
    expect(second.review?.said).toBe("也完全正确。");
    expect(third.n).toBe(3);
    expect(third.review?.said).toBe("第三题逻辑基本对，但有一个细节： 而题目要求是 3 到 10 之间。");
    const units = wikiLedgerUnits(withLearnerCode(empty("learning"), [material(46, "assistant", "第三题，最重要：\n\n规则：\n\n> 如果电压在 3 到 10 之间，输出 `Normal`。"), material(48, "assistant", review)], true));
    expect(units.find(unit => unit.evidence.code?.text.startsWith("if voltage"))?.evidence.task?.said).toBe("如果电压在 3 到 10 之间，输出 `Normal`。");
  });

  it("takes the clause naming the exercise, and no task set for another lesson", () => {
    const review = "可以，而且你这三题整体做得不错。第一题、第三题都对；第二题有一个小拼写错误：\n\n你写的是：\n\n```python\nvoltage[1] = 4.8\n```\n\n但变量名是 voltages。";
    const [found] = quotedCode(review);
    expect(found.n).toBe(2);
    expect(found.review?.said).toBe("第二题有一个小拼写错误： 但变量名是 voltages。");
    const set = material(47, "assistant", "第二题：\n\n```python\ntemperature = 37\npressure = 120\n```\n\n> 如果温度大于 35，或者压力大于 150，输出 `Warning`。");
    expect(wikiLedgerUnits(withLearnerCode(empty("learning"), [set, material(51, "assistant", review)], true))[0].evidence.task).toBeUndefined();
    // A rule set for tomorrow, under "规则：", is no recalled task.
    expect(quotedCode("第三题尤其重要：\n\n```python\ndef check(v):\n    return v > 10\n```\n\n也是完全正确。明天自己写一个：\n\n规则：\n\n```text\nspeed > 100 → Fast\n```")[0].asked).toBeUndefined();
  });

  it("takes the task the AI recalls in its review as the exercise's", () => {
    const [found] = quotedCode("第三题的问题在这里：\n\n```python\nelif voltage > 5:\n    print(\"Low\")\n```\n\n我原来的要求是：\n\n```text\nvoltage > 10 → High\nvoltage < 3  → Low\n其他         → Normal\n```\n\n应该写成：\n\n```python\nif voltage > 10:\n    print(\"High\")\nelif voltage < 3:\n    print(\"Low\")\n```");
    expect(found.asked).toBe("voltage > 10 → High；voltage < 3 → Low；其他 → Normal");
    expect(found.review?.shows).toBeUndefined();
    const units = wikiLedgerUnits(withLearnerCode(empty("learning"), [material(44, "assistant", "第三题的问题在这里：\n\n```python\nelif voltage > 5:\n    print(\"Low\")\n```\n\n我原来的要求是：\n\n```text\nvoltage > 10 → High\n其他 → Normal\n```")], true));
    expect(units[0].evidence.task).toEqual({ said: "voltage > 10 → High；其他 → Normal" });
  });

  it("keeps the AI's review of each exercise: what was wrong, and its version, up to the next exercise", () => {
    const text = "第一题：\n\n```python\nrobot = {\"name\": \"R1\"}\nprint(robot[\"name\"])\n```\n\n这题完全正确。\n\n第二题有问题。你写的是：\n\n```python\ncontroller = {\"kp\": 2.0}\n\"kp\" = 3.0\n```\n\n字符串不能被赋值，要通过键去改字典里的值。\n\n应该写成：\n\n```python\ncontroller[\"kp\"] = 3.0\ncontroller[\"kd\"] = 0.1\n```\n\n## 下一课\n\n明天学函数。";
    const [first, second] = quotedCode(text);
    expect(first.review).toEqual({ said: "这题完全正确。" });
    expect(second.review).toEqual({ said: "字符串不能被赋值，要通过键去改字典里的值。", code: { language: "python", text: "controller[\"kp\"] = 3.0\ncontroller[\"kd\"] = 0.1" } });
    // The learner's own message comes first; the AI's review of it, quoting it back, is its review.
    const materials = [material(62, "user", "第二题：\n```python\ncontroller = {\"kp\": 2.0}\n\"kp\" = 3.0\n```"), material(63, "assistant", text)];
    const units = wikiLedgerUnits(withLearnerCode(empty("learning"), materials, true));
    expect(units.find(unit => unit.evidence.messageIndex === 62)?.evidence.review?.code?.text).toBe("controller[\"kp\"] = 3.0\ncontroller[\"kd\"] = 0.1");
  });

  it("reads past a block the AI's words lead into, keeping it, up to the AI's version", () => {
    const text = "第二题有问题。你写的是：\n\n```python\ncontroller = {\"kp\": 2.0}\n\"kp\" = 3.0\n```\n\n这样不行，因为：\n\n```text\n\"kp\" 是一个字符串，不是变量\n```\n\n要修改字典里的值，必须通过键。\n\n应该写成：\n\n```python\ncontroller[\"kp\"] = 3.0\n```\n\n其他都对。";
    expect(quotedCode(text)[0].review).toEqual({ said: "这样不行，因为： 要修改字典里的值，必须通过键。", code: { language: "python", text: "controller[\"kp\"] = 3.0" }, shows: { language: "text", text: "\"kp\" 是一个字符串，不是变量" } });
  });

  it("adds them as exercises to a learning record only, once, and keeps them through an update", () => {
    const materials = [material(43, "user", "第三题：\nvoltage = 7\nif voltage > 5:\n    print(\"Low\")"), material(44, "assistant", "第三题的问题在这里：\n\n```python\nif voltage > 5:\n    print(\"Low\")\n```"), material(68, "assistant", "你最后这一句：\n\n```python\nprint(f\"{name}: {result}\")\n```")];
    // A project's extraction is left as it is.
    expect(withLearnerCode(empty("project"), materials, true)).toEqual(empty("project"));
    const learning = withLearnerCode(empty("learning"), materials, true), units = wikiLedgerUnits(learning);
    expect(units.map(unit => [unit.evidence.messageIndex, unit.evidence.role, unit.subject, unit.statement])).toEqual([[43, "user", "条件判断", "第三题："], [68, "assistant", "字符串格式化", "你最后这一句"]]);
    expect(units.every(unit => unit.evidence.learnerCode && heuristicLearningRole(unit) === "exercise")).toBe(true);
    expect(wikiLedgerUnits(withLearnerCode(learning, materials, true))).toHaveLength(2);
    const reextracted = { ...learning, batches: learning.batches.filter(batch => batch.signature !== LEARNER_CODE_BATCH) };
    expect(wikiLedgerUnits(keptLearnerCode(reextracted, learning))).toHaveLength(2);
    expect(keptLearnerCode(empty("project"), empty("project"))).toEqual(empty("project"));
  });
});
