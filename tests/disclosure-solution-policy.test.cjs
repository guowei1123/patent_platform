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
const {
  initialState,
  commandSchema,
} = require("../src/mastra/disclosure/contracts.ts");
const {
  applyModelResult,
  checkDisclosure,
} = require("../src/mastra/disclosure/quality.ts");
const {
  getUserTechnicalSolution,
  inspectTechnicalSolution,
  isTechnicalSolutionPolish,
  applyExtractedUserSolution,
} = require("../src/mastra/disclosure/technical-solution-policy.ts");
const original =
  "温度传感器进行采集模组温度，控制器进行比较温差并调节水泵转速。温差大于5摄氏度时设置80%占空比。";
const polished =
  "温度传感器采集模组温度；控制器比较温差并调节水泵转速。\n温差大于5摄氏度时设置80%占空比。";
const stateWithSolution = (text = original) => {
  const state = initialState();
  state.sections.technicalSolution = text;
  state.sources.push({
    id: "user-original",
    label: "用户编辑：technicalSolution",
    text,
  });
  return state;
};
const stateWithChapters = () => {
  const state = stateWithSolution();
  for (const [section, text] of Object.entries({
    techBackground: "用户确认的背景",
    beneficialEffects: "已确认效果",
    protectionPoints: "已确认保护点",
  })) {
    state.sections[section] = text;
    state.sources.push({ id: section, label: `用户编辑：${section}`, text });
  }
  return state;
};
const command = (action, extra = {}) =>
  commandSchema.parse({
    action,
    baseVersion: 0,
    operationId: crypto.randomUUID(),
    message: "测试",
    ...extra,
  });
const result = (patches = []) => ({
  reply: "已整理",
  facts: [],
  questions: [],
  issues: [],
  patches,
});
function loadMocked(path, mocks) {
  const filename = require.resolve(path);
  delete require.cache[filename];
  const previous = Module._load;
  Module._load = function (request, ...args) {
    return Object.hasOwn(mocks, request)
      ? mocks[request]
      : previous.call(this, request, ...args);
  };
  try {
    return require(path);
  } finally {
    Module._load = previous;
  }
}

test("空白和仅有目标的方案必须提醒补充，具体的短方案可以通过", () => {
  for (const text of [
    "",
    "  \n",
    "提升效率",
    "本发明希望通过智能化技术优化系统并全面提升管理效率和可靠性",
    "使用先进AI技术对数据进行处理，实现智能管理和效率提升",
  ])
    assert.equal(inspectTechnicalSolution(text).ready, false);
  assert.match(inspectTechnicalSolution("").message, /未找到核心技术方案/);
  assert.match(inspectTechnicalSolution("提升效率").message, /空泛/);
  assert.equal(inspectTechnicalSolution(original).ready, true);
  assert.equal(
    inspectTechnicalSolution(
      "温度传感器采集模组温度，控制器比较温差并调节水泵转速。",
    ).ready,
    true,
  );
});

test("历史 AI 正文、专利和对话不能充当用户明确填写的核心方案", () => {
  const state = initialState();
  state.sections.technicalSolution = original;
  state.sources.push({ id: "patent", label: "检索专利", text: original });
  assert.equal(getUserTechnicalSolution(state), "");
  assert.ok(
    checkDisclosure(state).some((issue) =>
      issue.message.includes("未找到核心技术方案"),
    ),
  );
  state.sources.push({
    id: "user",
    label: "用户编辑：technicalSolution",
    text: original,
  });
  state.sources.push({
    id: "clear",
    label: "用户编辑：technicalSolution",
    text: "",
  });
  assert.equal(getUserTechnicalSolution(state), "", "清空原文不能回退到旧来源");
});

test("仅允许排版及冗余动词整理，阻止参数、部件、步骤或顺序变化", () => {
  assert.equal(isTechnicalSolutionPolish(original, polished), true);
  for (const candidate of [
    polished.replace("5摄氏度", "8摄氏度"),
    polished.replace("80%", "90%"),
    polished + "使用预测模型提前调节旁通阀。",
    polished.replace("水泵", "旁通阀"),
    polished.replace("采集模组温度", ""),
    "",
    polished.split("；").reverse().join("；"),
  ])
    if (candidate !== polished)
      assert.equal(isTechnicalSolutionPolish(original, candidate), false);
  assert.equal(isTechnicalSolutionPolish("参数为0.1。", "参数为01。"), false);
  assert.equal(
    isTechnicalSolutionPolish("输入为10、20。", "输入为1020。"),
    false,
  );
  assert.equal(isTechnicalSolutionPolish("温度为-10。", "温度为10。"), false);
});

test("message 和 draft 不能生成技术方案，即使用户原文已存在", () => {
  for (const action of ["message", "draft"])
    for (const state of [initialState(), stateWithSolution()]) {
      const next = applyModelResult(
        state,
        result([
          {
            section: "technicalSolution",
            content: polished,
            reason: "AI 生成",
          },
        ]),
        command(action),
      );
      assert.equal(
        next.sections.technicalSolution,
        state.sections.technicalSolution,
      );
      assert.equal(next.suggestions.length, 0);
    }
});

test("合法语言优化只成为待确认建议，新增技术内容不会进入正文或建议", () => {
  const state = stateWithSolution();
  const accepted = applyModelResult(
    state,
    result([
      { section: "technicalSolution", content: polished, reason: "优化" },
    ]),
    command("revise", { section: "technicalSolution" }),
  );
  assert.equal(accepted.sections.technicalSolution, original);
  assert.equal(accepted.suggestions[0].content, polished);
  const rejected = applyModelResult(
    state,
    result([
      {
        section: "technicalSolution",
        content: polished + "采用新算法预测温度。",
        reason: "优化",
      },
    ]),
    command("revise", { section: "technicalSolution" }),
  );
  assert.equal(rejected.sections.technicalSolution, original);
  assert.equal(rejected.suggestions.length, 0);
});

test("主智能体仅编排工具，缺少用户方案时停止，正文全部来自工具返回", async () => {
  const calls = [];
  let receivedImageAssets;
  let primaryCalls = 0;
  const tools = loadMocked("../src/mastra/tools/disclosure-tools.ts", {
    "@mastra/core/tools": {
      createTool(options) {
        return options;
      },
    },
    "../disclosure/service-adapter": {
      async runDisclosureFeature(feature, input) {
        calls.push(feature);
        if (feature === "images") receivedImageAssets = input.imageAssets;
        const next = structuredClone(input.result);
        if (feature === "materials") {
          const source = input.state.sources.find(
            (source) => source.text === original,
          );
          if (source)
            next.technicalSolutionQuotes = [
              { sourceId: source.id, quote: source.text },
            ];
        }
        if (feature === "materials")
          next.patches.push(
            {
              section: "inventionName",
              content: "电池热管理",
              reason: "工具提取",
            },
            {
              section: "technicalField",
              content: "电池冷却",
              reason: "工具提取",
            },
          );
        if (feature === "background")
          next.patches.push({
            section: "techBackground",
            content: "背景工具输出",
            reason: "工具返回",
          });
        if (feature === "benefits" || feature === "protection") {
          assert.ok(
            next.patches.some(
              (patch) =>
                patch.section === "techBackground" &&
                patch.content === "背景工具输出",
            ),
            "后续工具必须收到背景工具结果",
          );
          next.patches.push({
            section:
              feature === "benefits" ? "beneficialEffects" : "protectionPoints",
            content: "对应工具输出",
            reason: "工具返回",
          });
        }
        next.reply = "工具返回的状态";
        return next;
      },
    },
  });
  const agent = loadMocked("../src/mastra/agents/disclosure-agent.ts", {
    "@mastra/core/agent": {
      Agent: class {
        constructor(options) {
          Object.assign(this, options);
        }
        generate() {
          primaryCalls++;
          throw new Error("主智能体禁止生成正文");
        }
      },
    },
    "../model": { patentAgentModel: {} },
    "../tools/disclosure-tools": tools,
  });
  const steps = {};
  const chain = {
    then() {
      return this;
    },
    commit() {
      return this;
    },
  };
  loadMocked("../src/mastra/workflows/disclosure-workflow.ts", {
    "@mastra/core/workflows": {
      createStep(options) {
        steps[options.id] = options;
        return options;
      },
      createWorkflow() {
        return chain;
      },
    },
    "@mastra/core/tools": { noopObserve: {} },
    "../agents/disclosure-agent": agent,
    "../tools/disclosure-tools": tools,
  });
  const run = async (state, cmd) => {
    const planned = await steps["plan-disclosure-tools"].execute({
      inputData: { state, command: cmd },
    });
    const executed = await steps["execute-disclosure-tools"].execute({
      inputData: planned,
    });
    return steps["validate-disclosure-tool-results"].execute({
      inputData: executed,
    });
  };
  for (const state of [initialState(), stateWithSolution("提升效率")]) {
    const response = await run(state, command("draft"));
    assert.equal(
      response.sections.technicalSolution,
      state.sections.technicalSolution,
    );
    assert.match(response.messages.at(-1).text, /未找到|空泛/);
  }
  assert.deepEqual(calls, ["materials", "materials"]);
  calls.length = 0;
  const response = await run(stateWithSolution(), command("draft"));
  assert.deepEqual(calls, [
    "materials",
    "background",
    "benefits",
    "protection",
    "problems",
  ]);
  assert.equal(primaryCalls, 0);
  assert.equal(response.sections.technicalSolution, original);
  assert.equal(response.sections.techBackground, "");
  const userDraft = stateWithChapters();
  const optimizedChapters = await run(userDraft, command("draft"));
  assert.equal(
    optimizedChapters.sections.techBackground,
    userDraft.sections.techBackground,
  );
  assert.ok(
    optimizedChapters.suggestions.some(
      (patch) =>
        patch.section === "techBackground" && patch.content === "背景工具输出",
    ),
  );
  const submitted = initialState();
  submitted.sources.push({
    id: "uploaded",
    label: "用户文档.docx",
    text: original,
  });
  const extracted = await run(submitted, command("draft"));
  assert.equal(extracted.sections.technicalSolution, original);
  assert.equal(getUserTechnicalSolution(extracted), original);
  assert.deepEqual(
    agent.planDisclosureTools(
      command("revise", { section: "technicalSolution" }),
    ).tools,
    ["polishDisclosureSolutionTool"],
  );
  assert.deepEqual(
    agent.planDisclosureTools(
      command("revise", { section: "beneficialEffects" }),
    ).tools,
    ["generateDisclosureBenefitsTool"],
  );
  assert.deepEqual(agent.planDisclosureTools(command("check")).tools, [
    "detectDisclosureProblemsTool",
    "checkDisclosureImagesTool",
  ]);
  assert.deepEqual(agent.planDisclosureTools(command("generate-background")), {
    requiresSolution: true,
    tools: ["generateDisclosureBackgroundTool"],
  });
  assert.deepEqual(
    agent.planDisclosureTools(command("generate-benefits")).tools,
    ["generateDisclosureBenefitsTool", "generateDisclosureProtectionTool"],
  );
  assert.deepEqual(
    agent.planDisclosureTools(command("optimize-solution")).tools,
    [
      "polishDisclosureSolutionTool",
      "detectDisclosureProblemsTool",
      "checkDisclosureImagesTool",
      "explainDisclosureTermsTool",
    ],
  );
  assert.deepEqual(agent.planDisclosureTools(command("save-step")).tools, []);
  calls.length = 0;
  await run(stateWithSolution("提升效率"), command("optimize-solution"));
  assert.deepEqual(
    calls,
    ["polish", "problems", "images", "terms"],
    "优化或核心方案警告不应截断检测工具链",
  );
  const imageInput = [
    { id: crypto.randomUUID(), mime: "image/png", base64: "test" },
  ];
  const plannedImages = await steps["plan-disclosure-tools"].execute({
    inputData: {
      state: initialState(),
      command: command("check-images"),
      imageAssets: imageInput,
    },
  });
  assert.deepEqual(plannedImages.imageAssets, imageInput);
  await steps["execute-disclosure-tools"].execute({ inputData: plannedImages });
  assert.deepEqual(receivedImageAssets, imageInput);
});

test("五步保存允许短方案及图片警告继续，返回修改只保留既有章节", () => {
  const {
    saveDisclosureWritingStep,
    missingWritingFields,
  } = require("../src/mastra/disclosure/writing-flow.ts");
  let state = initialState();
  assert.throws(
    () =>
      saveDisclosureWritingStep(
        state,
        command("save-step", { writingStep: 1 }),
      ),
    /必填/,
  );
  state = saveDisclosureWritingStep(
    state,
    command("save-step", {
      sections: {
        inventionName: "电池冷却",
        contactPerson: "张三",
        technicalField: "热管理",
        applicationType: "发明",
      },
      writingStep: 1,
    }),
  );
  assert.equal(state.sections.technicalSolution, "");
  state = saveDisclosureWritingStep(
    state,
    command("save-step", {
      sections: { techBackground: "现有技术背景" },
      writingStep: 2,
    }),
  );
  state.issues.push({
    section: "technicalSolution",
    severity: "warning",
    message: "图片格式有问题",
  });
  state = saveDisclosureWritingStep(
    state,
    command("save-step", {
      solutionBlocks: [{ id: "a", content: "提升效率" }],
      writingStep: 3,
    }),
  );
  assert.equal(state.writingStep, 3);
  assert.equal(
    inspectTechnicalSolution(getUserTechnicalSolution(state)).ready,
    false,
  );
  state = saveDisclosureWritingStep(
    state,
    command("save-step", {
      sections: {
        beneficialEffects: "人工确认的效果",
        protectionPoints: "人工确认的保护点",
      },
      writingStep: 4,
    }),
  );
  assert.deepEqual(missingWritingFields(state, 4), []);
  state = saveDisclosureWritingStep(
    state,
    command("save-step", {
      solutionBlocks: [{ id: "a", content: original }],
      writingStep: 2,
    }),
  );
  assert.equal(state.sections.beneficialEffects, "人工确认的效果");
  assert.equal(state.sections.protectionPoints, "人工确认的保护点");
  assert.ok(state.generatedSections.includes("beneficialEffects"));
  assert.equal(getUserTechnicalSolution(state), original);
});

test("草稿比较忽略数据库返回的对象字段顺序，仍识别内容和分栏顺序变化", () => {
  const {
    writingDraftKey,
  } = require("../src/mastra/disclosure/writing-flow.ts");
  const draft = {
    sections: {
      inventionName: "测试装置",
      contactPerson: "用户",
      technicalField: "温控",
    },
    solutionBlocks: [
      { id: "a", content: "采样温度" },
      { id: "b", content: "调节泵速" },
    ],
    keywords: [{ term: "温度", definition: "测量值" }],
    writingStep: 2,
  };
  const returned = {
    writingStep: 2,
    keywords: [{ definition: "测量值", term: "温度" }],
    solutionBlocks: [
      { content: "采样温度", id: "a" },
      { content: "调节泵速", id: "b" },
    ],
    sections: {
      contactPerson: "用户",
      technicalField: "温控",
      inventionName: "测试装置",
    },
  };
  assert.equal(writingDraftKey(draft), writingDraftKey(returned));
  assert.notEqual(
    writingDraftKey(draft),
    writingDraftKey({
      ...returned,
      sections: { ...returned.sections, contactPerson: "另一用户" },
    }),
  );
  assert.notEqual(
    writingDraftKey(draft),
    writingDraftKey({
      ...returned,
      solutionBlocks: [...returned.solutionBlocks].reverse(),
    }),
  );
});

test("连续保存方案只保留当前编辑来源，旧原稿不被修改，也不会累积超限", () => {
  const {
    saveDisclosureWritingStep,
  } = require("../src/mastra/disclosure/writing-flow.ts");
  const { stateSchema } = require("../src/mastra/disclosure/contracts.ts");
  let state = initialState();
  state.sources.push({ id: "file", label: "原始材料.docx", text: original });
  const first = saveDisclosureWritingStep(
    state,
    command("save-step", {
      solutionBlocks: [{ id: "solution", content: original }],
    }),
  );
  state = first;
  for (let index = 0; index < 180; index++) {
    state = saveDisclosureWritingStep(
      state,
      command("save-step", {
        solutionBlocks: [
          { id: "solution", content: `${original}\n修改记录${index}。` },
        ],
      }),
    );
    stateSchema.parse(state);
  }
  assert.equal(state.sources.length, 2);
  assert.equal(state.sources[0].id, "file");
  assert.equal(getUserTechnicalSolution(state), `${original}\n修改记录179。`);
  assert.equal(first.sections.technicalSolution, original);
  assert.equal(first.sources.at(-1).text, original);
});

test("保存时保留旧编辑来源中仍被事实和方案引文引用的内容", () => {
  const {
    saveDisclosureWritingStep,
  } = require("../src/mastra/disclosure/writing-flow.ts");
  const state = stateWithSolution();
  state.facts.push({
    sourceId: "user-original",
    text: "用户方案",
    quote: original,
    category: "技术手段",
  });
  state.technicalSolutionQuotes = [
    { sourceId: "user-original", quote: original },
  ];
  const next = saveDisclosureWritingStep(
    state,
    command("save-step", {
      solutionBlocks: [{ id: "solution", content: polished }],
    }),
  );
  assert.equal(
    next.sources.find((source) => source.id === "user-original").text,
    original,
  );
  assert.equal(getUserTechnicalSolution(next), polished);
});

test("图片检测与术语服务结果独立保存，不注入技术方案；优化分栏必须与正文一致", () => {
  const state = stateWithSolution();
  const imageId = crypto.randomUUID();
  state.images.push({
    id: imageId,
    name: "图.png",
    caption: "图1",
    detection: "pending",
    reason: "待检测",
  });
  const output = result([
    {
      section: "technicalSolution",
      content: polished,
      reason: "语言优化",
      solutionBlocks: [{ id: "a", content: "新增技术" }],
    },
  ]);
  output.keywords = [{ term: "温度传感器", definition: "测量温度的器件" }];
  output.imageChecks = [
    {
      id: imageId,
      detection: "warning",
      reason: "图片非白底",
      review: {
        status: "warning",
        summary: "请复核图注",
        detectedLabels: [],
        issues: ["图注缺失"],
      },
    },
  ];
  const next = applyModelResult(state, output, command("optimize-solution"));
  assert.equal(next.sections.technicalSolution, original);
  assert.equal(next.suggestions.length, 0);
  assert.equal(next.keywords[0].term, "温度传感器");
  assert.equal(next.images[0].detection, "warning");
  assert.ok(next.issues.some((issue) => issue.message.includes("非白底")));
});

test("提交材料后只复制可核验的方案原文，不要求另填表单", () => {
  const state = initialState();
  state.solutionBlocks = [{ id: "solution", content: "" }];
  state.sources = [
    {
      id: "file",
      label: "方案.docx",
      text: `背景资料\n${original}\n联系人信息`,
    },
  ];
  const extracted = result();
  extracted.technicalSolutionQuotes = [{ sourceId: "file", quote: original }];
  const next = applyModelResult(state, extracted, command("message"));
  assert.equal(next.sections.technicalSolution, original);
  assert.equal(next.solutionBlocks[0].content, original);
  assert.equal(getUserTechnicalSolution(next), original);
  assert.equal(state.sections.technicalSolution, "");
});

test("伪造、乱序或无来源的方案引文不能写入正文", () => {
  const state = initialState();
  state.sources = [
    { id: "first", label: "用户输入", text: original },
    {
      id: "second",
      label: "补充输入",
      text: "控制器读取温差数据并调节水泵转速。",
    },
  ];
  for (const quotes of [
    [{ sourceId: "first", quote: original + "增加新算法。" }],
    [{ sourceId: "missing", quote: original }],
    [
      { sourceId: "second", quote: state.sources[1].text },
      { sourceId: "first", quote: original },
    ],
  ]) {
    const output = result();
    output.technicalSolutionQuotes = quotes;
    const next = applyModelResult(state, output, command("message"));
    assert.equal(next.sections.technicalSolution, "");
    assert.match(next.messages.at(-1).text, /未找到核心技术方案/);
  }
});

test("用户手动清空方案后，只允许新提交的原文恢复方案", () => {
  const state = stateWithSolution();
  state.sources.push({
    id: "clear",
    label: "用户编辑：technicalSolution",
    text: "",
  });
  state.sections.technicalSolution = "";
  const old = result();
  old.technicalSolutionQuotes = [
    { sourceId: "user-original", quote: original },
  ];
  assert.equal(
    getUserTechnicalSolution(applyExtractedUserSolution(state, old)),
    "",
  );
  state.sources.push({ id: "new-input", label: "用户补充", text: original });
  const fresh = result();
  fresh.technicalSolutionQuotes = [{ sourceId: "new-input", quote: original }];
  assert.equal(
    getUserTechnicalSolution(applyExtractedUserSolution(state, fresh)),
    original,
  );
});

test("服务适配器只把用户原文传入下游，忽略主智能体伪造的方案", async () => {
  const inputs = [];
  let optimizationCalls = 0;
  const { enrichDisclosureWithServices } = loadMocked(
    "../src/mastra/disclosure/service-adapter.ts",
    {
      "@/app/api/disclosure/material-organization/service": {
        async organizeDisclosureMaterials() {
          return result();
        },
      },
      "@/app/api/disclosure/explanation-of-keywords/service": {
        generateKeywordsExplanation: async () => ({ keywords: [] }),
      },
      "@/app/api/disclosure/image-detection/service": {
        detectImageProperties: async () => ({
          isWhiteBackground: true,
          isBlackLines: true,
          reason: "格式通过",
        }),
      },
      "./image-cross-check": {
        crossCheckDisclosureImage: async () => ({
          status: "passed",
          summary: "图文通过",
          detectedLabels: [],
          issues: [],
        }),
      },
      "@/app/api/disclosure/background-generation/service": {
        async generateBackground() {
          return "技术背景";
        },
      },
      "@/app/api/disclosure/beneficial-effect-generation/service": {
        async generateBeneficialEffects(input) {
          inputs.push(input.technicalSolution);
          return "定性效果";
        },
      },
      "@/app/api/disclosure/pre-protection-point-generation/service": {
        async generateProtectionPoints(input) {
          inputs.push(input.technicalSolution);
          return "保护特征";
        },
      },
      "@/app/api/disclosure/problem-detection/service": {
        async detectDisclosureProblems(input) {
          inputs.push(input.technicalSolution);
          return "";
        },
      },
      "@/app/api/disclosure/proposal-text-optimization/service": {
        async optimizeProposalText(input) {
          optimizationCalls++;
          inputs.push(input.text);
          return polished;
        },
      },
    },
  );
  const state = stateWithChapters();
  state.sections.inventionName = "电池热管理";
  state.sections.technicalField = "电池冷却";
  const enriched = await enrichDisclosureWithServices({
    state,
    command: command("draft"),
    drafting: true,
    result: result([
      { section: "technicalSolution", content: "新增方案", reason: "编造" },
    ]),
  });
  assert.deepEqual(inputs, [original, original, original]);
  assert.equal(optimizationCalls, 0);
  assert.ok(
    enriched.patches.every((patch) => patch.section !== "technicalSolution"),
  );
  await enrichDisclosureWithServices({
    state,
    command: command("revise", { section: "technicalSolution" }),
    drafting: false,
    result: result([
      { section: "technicalSolution", content: "新增方案", reason: "编造" },
    ]),
  });
  assert.equal(optimizationCalls, 1);
  assert.ok(inputs.every((input) => input === original));
});

test("分步服务：章节需用户原稿和方案，仅显式优化；分栏、术语和图片检测调用独立服务", async () => {
  const calls = [];
  let failImages = false;
  const { runDisclosureFeature } = loadMocked(
    "../src/mastra/disclosure/service-adapter.ts",
    {
      "@/app/api/disclosure/material-organization/service": {
        organizeDisclosureMaterials: async () => result(),
      },
      "@/app/api/disclosure/background-generation/service": {
        generateBackground: async (input) => {
          calls.push(["background", input]);
          return "通用技术背景";
        },
      },
      "@/app/api/disclosure/beneficial-effect-generation/service": {
        generateBeneficialEffects: async (input) => {
          calls.push(["benefits", input]);
          return "定性效果";
        },
      },
      "@/app/api/disclosure/pre-protection-point-generation/service": {
        generateProtectionPoints: async (input) => {
          calls.push(["protection", input]);
          return "保护点";
        },
      },
      "@/app/api/disclosure/proposal-text-optimization/service": {
        optimizeProposalText: async (input) => {
          calls.push(["polish", input]);
          return input.text.replace(/进行/g, "");
        },
      },
      "@/app/api/disclosure/problem-detection/service": {
        detectDisclosureProblems: async () => "方案较简短，请核实实施细节。",
      },
      "@/app/api/disclosure/explanation-of-keywords/service": {
        generateKeywordsExplanation: async (input) => {
          calls.push(["terms", input]);
          return {
            keywords: [
              { term: "温度传感器", explanation: "测温器件" },
              { term: "虚构部件", explanation: "不应保留" },
            ],
          };
        },
      },
      "@/app/api/disclosure/image-detection/service": {
        detectImageProperties: async (input) => {
          calls.push(["images", input]);
          if (failImages) throw new Error("offline");
          return {
            isWhiteBackground: false,
            isBlackLines: true,
            reason: "背景不是白色",
          };
        },
      },
      "./image-cross-check": {
        crossCheckDisclosureImage: async () => {
          if (failImages) throw new Error("offline");
          return {
            status: "warning",
            summary: "图注不全",
            detectedLabels: [],
            issues: ["请补充图注"],
          };
        },
      },
    },
  );
  const basic = initialState();
  basic.sections.inventionName = "电池冷却系统";
  basic.sections.technicalField = "热管理";
  const bg = await runDisclosureFeature("background", {
    state: basic,
    command: command("generate-background"),
    result: result(),
  });
  assert.equal(bg.patches.length, 0);
  assert.equal(calls.length, 0);
  basic.sections.technicalSolution = original;
  basic.sections.techBackground = "用户确认的背景";
  basic.sources = ["technicalSolution", "techBackground"].map((section) => ({
    id: section,
    label: `用户编辑：${section}`,
    text: basic.sections[section],
  }));
  await runDisclosureFeature("background", {
    state: basic,
    command: command("generate-background"),
    result: result(),
  });
  assert.equal(calls.filter(([name]) => name === "background").length, 1);
  const state = stateWithChapters();
  for (const feature of ["benefits", "protection"])
    await runDisclosureFeature(feature, {
      state,
      command: command("generate-benefits"),
      result: result(),
    });
  assert.equal(
    calls.filter(([name]) => ["benefits", "protection"].includes(name)).length,
    2,
  );
  state.solutionBlocks = [
    { id: "a", content: original.split("。")[0] + "。" },
    { id: "b", content: "温差大于5摄氏度时设置80%占空比。" },
  ];
  state.sections.technicalSolution = state.solutionBlocks
    .map((block) => block.content)
    .join("\n");
  state.sources.find(
    (source) => source.label === "用户编辑：technicalSolution",
  ).text = state.sections.technicalSolution;
  let optimized = await runDisclosureFeature("polish", {
    state,
    command: command("optimize-solution", { blockId: "a" }),
    result: result(),
  });
  assert.equal(calls.filter(([name]) => name === "polish").length, 1);
  assert.equal(
    optimized.patches[0].solutionBlocks[1].content,
    state.solutionBlocks[1].content,
  );
  assert.equal(optimized.patches[0].solutionBlocks.length, 2);
  optimized = await runDisclosureFeature("terms", {
    state,
    command: command("optimize-solution"),
    result: optimized,
  });
  assert.deepEqual(optimized.keywords, [
    { term: "温度传感器", definition: "测温器件" },
  ]);
  const imageId = crypto.randomUUID();
  state.images.push({
    id: imageId,
    name: "test.png",
    caption: "",
    detection: "pending",
    reason: "待检查",
  });
  const png = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(100, 16);
  png.writeUInt32BE(100, 20);
  const input = {
    state,
    command: command("check-images"),
    result: result(),
    imageAssets: [
      { id: imageId, mime: "image/png", base64: png.toString("base64") },
    ],
  };
  const checked = await runDisclosureFeature("images", input);
  assert.equal(checked.imageChecks[0].detection, "warning");
  assert.equal(checked.imageChecks[0].review.status, "warning");
  failImages = true;
  const failed = await runDisclosureFeature("images", input);
  assert.equal(failed.imageChecks[0].detection, "failed");
  assert.equal(failed.imageChecks[0].review.status, "failed");
  assert.equal(
    state.sections.technicalSolution,
    state.sources.find(
      (source) => source.label === "用户编辑：technicalSolution",
    ).text,
  );
});

test("普通与流式优化在完整校验之前均不输出新增技术内容", async () => {
  let output = polished,
    calls = 0;
  const service = loadMocked(
    "../app/api/disclosure/proposal-text-optimization/service.ts",
    {
      "@langchain/core/prompts": {
        ChatPromptTemplate: {
          fromTemplate() {
            return {};
          },
        },
      },
      "@langchain/core/runnables": {
        RunnableSequence: {
          from() {
            return {
              async invoke() {
                calls++;
                return output;
              },
            };
          },
        },
      },
      "@langchain/core/output_parsers": { StringOutputParser: class {} },
      "@langchain/openai": { ChatOpenAI: class {} },
      "@langfuse/langchain": { CallbackHandler: class {} },
      "@/src/mastra/disclosure/technical-solution-policy": require("../src/mastra/disclosure/technical-solution-policy.ts"),
    },
  );
  await assert.rejects(
    service.optimizeProposalText({
      text: "提升效率",
      optimizationType: "detailed",
    }),
    /空泛/,
  );
  assert.equal(calls, 0);
  assert.equal(
    await service.optimizeProposalText({
      text: original,
      optimizationType: "detailed",
    }),
    polished,
  );
  output = polished + "增加旁通阀控制。";
  await assert.rejects(
    service.optimizeProposalText({
      text: original,
      optimizationType: "standard",
    }),
    /已拦截/,
  );
  await assert.rejects(
    service.streamProposalText({
      text: original,
      optimizationType: "standard",
    }),
    /已拦截/,
  );
});

test("采纳入口拒绝旧建议中的新技术，手工编辑才会记录新用户原文", async () => {
  let stored = stateWithSolution(),
    committed = false;
  const task = () => ({
    id: "test",
    state: structuredClone(stored),
    lastOperationId: null,
  });
  const { executeDisclosure } = loadMocked(
    "../src/mastra/disclosure/runtime.ts",
    {
      "../index": { mastra: {} },
      "./image-cross-check": {},
      "./patent-search": {},
      "./task-service": {
        async getDisclosureTask() {
          return task();
        },
        async claimDisclosure() {
          return task();
        },
        async failDisclosure() {},
        async commitDisclosure(resource, id, cmd, state) {
          committed = true;
          stored = state;
          return { state };
        },
      },
    },
  );
  stored.suggestions = [
    {
      section: "technicalSolution",
      content: polished + "增加旁通阀。",
      reason: "旧建议",
    },
  ];
  await assert.rejects(
    executeDisclosure(
      "user",
      "test",
      command("accept", { section: "technicalSolution" }),
    ),
    /不能采用/,
  );
  assert.equal(committed, false);
  stored.suggestions = [
    { section: "technicalSolution", content: polished, reason: "语言优化" },
  ];
  await executeDisclosure(
    "user",
    "test",
    command("accept", { section: "technicalSolution" }),
  );
  assert.equal(stored.sections.technicalSolution, polished);
  assert.equal(getUserTechnicalSolution(stored), original);
  const revised = original + "用户增加旁通阀控制。";
  await executeDisclosure(
    "user",
    "test",
    command("edit", { section: "technicalSolution", content: revised }),
  );
  assert.equal(getUserTechnicalSolution(stored), revised);
});

test("任务锁续期绑定当前用户和当前操作，不改动文稿版本", async () => {
  let statement, parameters;
  const { renewDisclosureLease } = loadMocked(
    "../src/mastra/disclosure/task-service.ts",
    {
      "../storage": {
        mastraStore: {
          db: {
            async none(sql, args) {
              statement = sql;
              parameters = args;
            },
          },
        },
      },
    },
  );
  await renewDisclosureLease("user-a", "task-a", "operation-a");
  assert.deepEqual(parameters, ["task-a", "user-a", "operation-a"]);
  assert.match(statement, /resource_id=\$2/);
  assert.match(statement, /operation_id=\$3/);
  assert.match(statement, /status='running'/);
  assert.doesNotMatch(statement, /SET[\s\S]*version\s*=/);
});
