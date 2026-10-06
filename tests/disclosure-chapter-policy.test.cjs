const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
const { initialState } = require("../src/mastra/disclosure/contracts.ts");
const {
  applyExtractedUserChapters,
  getUserChapter,
} = require("../src/mastra/disclosure/chapter-policy.ts");
const { applyModelResult } = require("../src/mastra/disclosure/quality.ts");
const {
  saveDisclosureWritingStep,
} = require("../src/mastra/disclosure/writing-flow.ts");
const original =
  "温度传感器采集电池温度，控制器比较温差并输出控制信号，调节水泵转速。";
const command = (action, extra = {}) => ({
  action,
  message: "优化已有原稿",
  operationId: crypto.randomUUID(),
  baseVersion: 0,
  ...extra,
});
const result = (patches) => ({
  facts: [],
  questions: [],
  issues: [],
  reply: "已处理",
  patches,
});
function loadOptimizer() {
  const filename =
    require.resolve("../app/api/disclosure/section-optimization/service.ts");
  delete require.cache[filename];
  const queue = [];
  let calls = 0;
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    if (name === "@langchain/openai")
      return {
        ChatOpenAI: class {
          withStructuredOutput() {
            return {
              invoke: async () => {
                calls++;
                if (!queue.length) throw new Error("unexpected model call");
                return queue.shift();
              },
            };
          }
        },
      };
    if (name === "@langfuse/langchain") return { CallbackHandler: class {} };
    if (name === "@/src/mastra/disclosure/contracts")
      return require("../src/mastra/disclosure/contracts.ts");
    if (name === "@/src/mastra/disclosure/technical-solution-policy")
      return require("../src/mastra/disclosure/technical-solution-policy.ts");
    return originalLoad.call(this, name, ...args);
  };
  try {
    return { ...require(filename), queue, calls: () => calls };
  } finally {
    Module._load = originalLoad;
  }
}
const input = {
  section: "beneficialEffects",
  userDraft: "改善温度控制。",
  technicalSolution: original,
};

test("章节为空或核心方案空泛时不调用模型，不能从空稿生成章节", async () => {
  const tool = loadOptimizer();
  await assert.rejects(
    tool.optimizeDisclosureSection({ ...input, userDraft: " " }),
    /先填写/,
  );
  await assert.rejects(
    tool.optimizeDisclosureSection({ ...input, technicalSolution: "提升效率" }),
    /空泛/,
  );
  assert.equal(tool.calls(), 0);
});
test("允许由既有控制关系推导的定性效果，完整核查后才返回建议", async () => {
  const tool = loadOptimizer();
  const text = "根据电池温度调节水泵转速，有助于改善温度控制的及时性。";
  tool.queue.push(
    { paragraphs: [{ text, solutionQuote: original }] },
    { approved: true, issues: [] },
  );
  assert.equal(await tool.optimizeDisclosureSection(input), text);
  assert.equal(tool.calls(), 2);
});
test("伪造核心依据或新增无依据数据的建议在输出前被拦截", async () => {
  let tool = loadOptimizer();
  tool.queue.push({
    paragraphs: [{ text: "增加蓝牙模块", solutionQuote: "蓝牙模块连接控制器" }],
  });
  await assert.rejects(tool.optimizeDisclosureSection(input), /原文依据/);
  assert.equal(tool.calls(), 1);
  tool = loadOptimizer();
  tool.queue.push({
    paragraphs: [{ text: "实测效率提高30%。", solutionQuote: original }],
  });
  await assert.rejects(tool.optimizeDisclosureSection(input), /无依据数值/);
  assert.equal(tool.calls(), 1);
});
test("保护点的分点编号不误判为实验参数，新增数字必须与原稿中的数值完整匹配", async () => {
  let tool = loadOptimizer();
  const text = "1. 温度传感器采集电池温度。\n2. 控制器调节水泵转速。";
  tool.queue.push(
    { paragraphs: [{ text, solutionQuote: original }] },
    { approved: true, issues: [] },
  );
  assert.equal(
    await tool.optimizeDisclosureSection({
      ...input,
      section: "protectionPoints",
    }),
    text,
  );
  tool = loadOptimizer();
  tool.queue.push({
    paragraphs: [{ text: "降低1摄氏度。", solutionQuote: original }],
  });
  await assert.rejects(
    tool.optimizeDisclosureSection({ ...input, userDraft: "降低10摄氏度。" }),
    /无依据数值/,
  );
});
test("引用真实方案却引入新部件或扩大保护范围时，语义核验拒绝输出", async () => {
  const tool = loadOptimizer();
  tool.queue.push(
    {
      paragraphs: [
        { text: "增加蓝牙模块实现远程控制。", solutionQuote: original },
      ],
    },
    { approved: false, issues: ["核心方案没有蓝牙或远程控制"] },
  );
  await assert.rejects(
    tool.optimizeDisclosureSection({ ...input, section: "protectionPoints" }),
    /偏离核心/,
  );
  assert.equal(tool.calls(), 2);
});
test("上传的章节只提取逐字原文；伪造引文、AI空章补丁以及手动清空后的旧材料均被拒绝", () => {
  const state = initialState();
  state.sources.push({
    id: "file",
    label: "用户材料.docx",
    text: "现有水泵控制响应不足。",
  });
  const raw = {
    section: "techBackground",
    content: state.sources[0].text,
    sourceQuotes: [{ sourceId: "file", quote: state.sources[0].text }],
    reason: "逐字原稿",
  };
  const extracted = applyExtractedUserChapters(state, result([raw]));
  assert.equal(getUserChapter(extracted, "techBackground"), raw.content);
  assert.equal(
    applyExtractedUserChapters(state, result([{ ...raw, content: "新增算法" }]))
      .sections.techBackground,
    "",
  );
  assert.equal(
    applyModelResult(
      state,
      result([
        {
          section: "beneficialEffects",
          content: "AI代写内容",
          reason: "自行生成",
        },
      ]),
      command("draft"),
    ).sections.beneficialEffects,
    "",
  );
  const cleared = saveDisclosureWritingStep(
    extracted,
    command("save-step", { sections: { techBackground: "" } }),
  );
  assert.equal(
    applyExtractedUserChapters(cleared, result([raw])).sections.techBackground,
    "",
  );
});
test("章节建议需用户确认，核心方案修改后删除旧章节建议", () => {
  const state = initialState();
  state.sections.technicalSolution = original;
  state.sections.beneficialEffects = input.userDraft;
  state.sources = ["technicalSolution", "beneficialEffects"].map((section) => ({
    id: section,
    label: `用户编辑：${section}`,
    text: state.sections[section],
  }));
  const next = applyModelResult(
    state,
    result([
      {
        section: "beneficialEffects",
        content: "有助于及时调节水泵转速。",
        reason: "合理补充",
      },
    ]),
    command("revise", { section: "beneficialEffects" }),
  );
  assert.equal(next.sections.beneficialEffects, input.userDraft);
  assert.equal(next.suggestions.length, 1);
  next.sections.protectionPoints = "温度采集和泵速控制关系。";
  next.sources.push({
    id: "protection",
    label: "用户编辑：protectionPoints",
    text: next.sections.protectionPoints,
  });
  const another = applyModelResult(
    next,
    result([
      {
        section: "protectionPoints",
        content: "温度传感器与控制器之间的连接及水泵调节关系。",
        reason: "归纳已有特征",
      },
    ]),
    command("revise", { section: "protectionPoints" }),
  );
  assert.equal(
    another.suggestions.length,
    2,
    "局部优化不能清除其他章节未采用的建议",
  );
  const changed = saveDisclosureWritingStep(
    another,
    command("save-step", {
      solutionBlocks: [
        {
          id: "solution",
          content: "采集温度，由控制器向风扇输出控制信号并调节风速。",
        },
      ],
    }),
  );
  assert.equal(changed.suggestions.length, 0);
});
