import { expect, it } from "vitest";
import { sentenceDiff } from "./text-diff";

it("diffs two chapter versions by sentence: removed, added and kept in reading order", () => {
  const before = "### 检索\n\n全文索引使用 Orama。索引在导入后更新。旧的说法会被删掉。";
  const after = "### 检索\n\n全文索引使用 Orama。索引在导入后增量更新。新增一句说明。";
  expect(sentenceDiff(before, after)).toEqual([
    { kind: "same", text: "### 检索" }, { kind: "same", text: "全文索引使用 Orama。" },
    { kind: "removed", text: "索引在导入后更新。" }, { kind: "removed", text: "旧的说法会被删掉。" },
    { kind: "added", text: "索引在导入后增量更新。" }, { kind: "added", text: "新增一句说明。" },
  ]);
  // Bold marks and spacing alone are no change.
  expect(sentenceDiff("**全文索引**使用 Orama。", "全文索引使用 Orama。").map(part => part.kind)).toEqual(["same"]);
});
