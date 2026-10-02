const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const AdmZip = require("adm-zip");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(
    ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
};

const {
  extractDisclosureText,
  parseDisclosureModelResponse,
} = require("../app/api/report/disclosure-parse/service.ts");
const {
  parseDocumentClassificationResponse,
  classifyEvidence,
  parseJson,
  normalizeCandidateScreening,
} = require("../app/api/report/document-relevance-classification/service.ts");
const {
  normalizeIpcCodes,
  resolvePatentTextColumns,
} = require("../app/api/report/patent-search/service.ts");
const {
  buildRetrievalPlan,
} = require("../app/api/report/retrieval-plan/service.ts");

test("交底书模型结果会去除代码块并归一化数组字段", () => {
  const result = parseDisclosureModelResponse(
    `\`\`\`json
    {
      "inventionName": "电池热管理方法",
      "technicalField": "新能源汽车",
      "backgroundTechnology": "现有冷却方式响应慢",
      "technicalProblem": "局部温差过大",
      "technicalSolution": "检测单体温差并控制局部冷却",
      "beneficialEffects": "提高温度一致性",
      "keyTechnicalFeatures": ["温差检测", {"feature":"局部冷却"}],
      "searchKeywords": ["电池热管理", "电池热管理", "局部冷却"],
      "ipcSuggestions": [{"ipc":"B60L", "description":"电动车辆"}]
    }
    \`\`\``,
    321,
  );
  assert.equal(result.inventionName, "电池热管理方法");
  assert.deepEqual(result.keyTechnicalFeatures, ["温差检测", "局部冷却"]);
  assert.deepEqual(result.searchKeywords, ["电池热管理", "局部冷却"]);
  assert.deepEqual(result.ipcSuggestions, [{ code: "B60L", name: "电动车辆" }]);
  assert.equal(result.sourceTextLength, 321);
});

test("交底书模型结果兼容内容块、说明文字与 data 包装", () => {
  const result = parseDisclosureModelResponse(
    [
      {
        type: "text",
        text: `已按要求提取：\n\`\`\`json\n${JSON.stringify({
          data: {
            发明名称: "图像识别方法",
            技术领域: "计算机视觉",
            背景技术: "传统识别准确率不足",
            技术问题: "复杂环境下误检",
            技术方案: "使用深度神经网络提取多尺度图像特征",
            有益效果: "提高识别准确率",
            关键技术特征: ["多尺度特征", "深度神经网络"],
            检索关键词: ["图像识别", "多尺度特征"],
            IPC建议: [{ code: "G06V", name: "图像识别" }],
          },
        })}\n\`\`\``,
      },
    ],
    456,
  );
  assert.equal(result.inventionName, "图像识别方法");
  assert.equal(result.technicalSolution, "使用深度神经网络提取多尺度图像特征");
  assert.deepEqual(result.keyTechnicalFeatures, ["多尺度特征", "深度神经网络"]);
  assert.equal(result.sourceTextLength, 456);
});

test("Mammoth 无法处理嵌套文本节点时从 DOCX XML 降级提取", async () => {
  const archive = new AdmZip();
  archive.addFile(
    "word/document.xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>一种基于<w:tab/>深度学习的图像识别方法</w:t></w:r></w:p>
          <w:p><w:r><w:t>解决复杂环境下的误检问题&amp;漏检问题</w:t></w:r></w:p>
        </w:body>
      </w:document>`,
      "utf8",
    ),
  );
  const text = await extractDisclosureText(archive.toBuffer());
  assert.match(text, /一种基于深度学习的图像识别方法/);
  assert.match(text, /误检问题&漏检问题/);
});

test("旧分类缺少量化证据时降为低置信度待复核结果", () => {
  const result = parseDocumentClassificationResponse({
    text: JSON.stringify({
      category: "Y类",
      confidence: "中等",
      conclusion: "单篇文献未完整披露",
      featureMappings: [
        {
          targetFeature: "局部冷却",
          referenceDisclosure: "未记载",
          assessment: "未披露",
        },
      ],
      reviewNote: "需要结合权利要求复核",
    }),
  });
  assert.equal(result.category, "A");
  assert.equal(result.confidence, "低");
  assert.equal(result.featureMappings[0].assessment, "未披露");
});

test("分类模型漏掉属性间逗号时会先进行安全格式修复", () => {
  assert.deepEqual(
    parseJson(`\`\`\`json
      {"features": []
       "documents": []}
    \`\`\``),
    { features: [], documents: [] },
  );
});

test("摘要初筛漏写或错写文献ID时保留有效候选，不中断报告", () => {
  const screening = normalizeCandidateScreening(
    {
      documents: [
        { id: "D1", proceed: false, reason: "摘要无关" },
        { id: "unknown", proceed: true, reason: "错误ID" },
      ],
    },
    [
      { id: "D1", abstract: "无关摘要" },
      { id: "D2", abstract: "可能相关摘要" },
    ],
  );
  assert.deepEqual(
    screening.map((item) => item.id),
    ["D1", "D2"],
  );
  assert.equal(screening[0].proceed, false);
  assert.equal(screening[1].proceed, true);
  assert.match(screening[1].reason, /结果缺失或文献 ID 无效/);
});

function evidenceFixture(first = ["F1"], second = ["F2"], score = "High") {
  return {
    features: [
      { id: "F1", text: "基础特征", isInnovation: false },
      { id: "F2", text: "核心创新", isInnovation: true },
    ],
    documents: [first, second].map((ids, index) => ({
      id: `D${index + 1}`,
      confidence: "中",
      materiallyRelevant: true,
      sameCoherentSolution: true,
      relationshipsPreserved: true,
      sequencePreserved: true,
      parameterLimitsPreserved: true,
      reviewNote: "仅摘要",
      disclosures: ids.map((featureId) => ({
        featureId,
        disclosureStatus: "EXPLICIT",
        sourceType: "claims",
        evidenceText: `权利要求公开${featureId}`,
      })),
    })),
    combinations: [
      {
        documentIds: ["D1", "D2"],
        motivationScore: score,
        motivationReason: "同一技术问题，互补特征可结合",
        motivationType: "SAME_TECHNICAL_PROBLEM",
        motivationEvidence: [
          {
            documentId: "D1",
            sourceType: "description",
            evidenceText: "同一技术问题",
          },
        ],
        technicallyCompatible: true,
        teachingAway: false,
        hindsightDetected: false,
      },
    ],
  };
}

function sourceMap() {
  return new Map([
    [
      "D1",
      {
        claims: "权利要求公开F1 权利要求公开F2",
        description: "同一技术问题",
        drawings: "",
      },
    ],
    [
      "D2",
      {
        claims: "权利要求公开F1 权利要求公开F2",
        description: "同一技术问题",
        drawings: "",
      },
    ],
  ]);
}

test("完整单篇及核心创新重合判X，无需组合", () => {
  const [result] = classifyEvidence(
    evidenceFixture(["F1", "F2"]),
    ["D1", "D2"],
    sourceMap(),
  );
  assert.equal(result.category, "X");
  assert.equal(result.metrics.coverageRate, 100);
  assert.equal(result.metrics.combinationRequired, false);
});

test("互补组合覆盖100且启示High判Y，Y优先于IO=false的A规则", () => {
  const results = classifyEvidence(
    evidenceFixture(),
    ["D1", "D2"],
    sourceMap(),
  );
  assert.deepEqual(
    results.map((item) => item.category),
    ["Y", "Y"],
  );
  assert.equal(results[0].metrics.innovationOverlap, false);
  assert.equal(results[0].metrics.coverageRate, 50);
  assert.equal(results[0].metrics.combinedCoverageRate, 100);
});

test("D1与两篇补充文件各自提供独立特征时可形成三篇Y组合", () => {
  const input = {
    features: [
      { id: "F1", text: "特征1", isInnovation: true, importance: "CORE" },
      { id: "F2", text: "特征2", isInnovation: true, importance: "CORE" },
      { id: "F3", text: "特征3", isInnovation: true, importance: "CORE" },
    ],
    documents: ["D1", "D2", "D3"].map((id, index) => ({
      id,
      confidence: "中",
      materiallyRelevant: true,
      sameCoherentSolution: true,
      relationshipsPreserved: true,
      sequencePreserved: true,
      parameterLimitsPreserved: true,
      reviewNote: "测试",
      disclosures: [
        {
          featureId: `F${index + 1}`,
          disclosureStatus: "EXPLICIT",
          sourceType: "claims",
          evidenceText: `权利要求公开F${index + 1}`,
        },
      ],
    })),
    combinations: [
      {
        documentIds: ["D1", "D2", "D3"],
        motivationScore: "High",
        motivationReason: "针对同一技术问题分别提供互补手段",
        motivationType: "SAME_TECHNICAL_PROBLEM",
        motivationEvidence: [
          {
            documentId: "D1",
            sourceType: "description",
            evidenceText: "同一技术问题",
          },
        ],
        technicallyCompatible: true,
        teachingAway: false,
        hindsightDetected: false,
      },
    ],
  };
  const sources = new Map(
    ["D1", "D2", "D3"].map((id, index) => [
      id,
      {
        claims: `权利要求公开F${index + 1}`,
        description: "同一技术问题",
        drawings: "",
      },
    ]),
  );
  const results = classifyEvidence(input, ["D1", "D2", "D3"], sources);
  assert.deepEqual(
    results.map((item) => item.category),
    ["Y", "Y", "Y"],
  );
  assert.equal(results[0].metrics.combinationDocumentIds.length, 3);
});

test("组合启示Low、覆盖未满或单篇零覆盖均判A", () => {
  for (const input of [
    evidenceFixture(["F1"], ["F2"], "Low"),
    evidenceFixture(["F1"], ["F1"]),
    evidenceFixture([], ["F1", "F2"]),
  ]) {
    assert.notEqual(
      classifyEvidence(input, ["D1", "D2"], sourceMap())[0].category,
      "Y",
    );
  }
});

test("部分披露、空证据不计入覆盖；无效组合文献会被忽略", () => {
  const input = evidenceFixture();
  input.documents[0].disclosures[0].disclosureStatus = "PARTIAL";
  assert.equal(
    classifyEvidence(input, ["D1", "D2"], sourceMap())[0].metrics.coverageRate,
    0,
  );
  input.documents[0].disclosures[0].disclosureStatus = "EXPLICIT";
  input.documents[0].disclosures[0].evidenceText = "不存在的原文";
  assert.equal(
    classifyEvidence(input, ["D1", "D2"], sourceMap())[0].metrics.coverageRate,
    0,
  );
  input.combinations[0].documentIds = ["D1", "fake"];
  assert.doesNotThrow(() =>
    classifyEvidence(input, ["D1", "D2"], sourceMap()),
  );
  input.combinations[0].documentIds = ["D1", "D1"];
  assert.doesNotThrow(() =>
    classifyEvidence(input, ["D1", "D2"], sourceMap()),
  );
});

test("模型重复或漏写特征和文献ID时按无披露证据补齐", () => {
  const input = evidenceFixture();
  input.features.push({ id: "F1", text: "重复特征", isInnovation: true });
  input.documents[1].id = "D1";
  const results = classifyEvidence(input, ["D1", "D2"], sourceMap());
  assert.equal(results.length, 2);
  assert.equal(results[1].category, "EXCLUDE");
});

test("X必须是同一完整方案；无动机证据不判Y", () => {
  const input = evidenceFixture(["F1", "F2"]);
  input.documents[0].sameCoherentSolution = false;
  assert.equal(
    classifyEvidence(input, ["D1", "D2"], sourceMap())[0].category,
    "REVIEW_REQUIRED",
  );
  const partial = evidenceFixture();
  partial.combinations = [];
  assert.notEqual(
    classifyEvidence(partial, ["D1", "D2"], sourceMap())[0].category,
    "Y",
  );
});

test("无可回查的证据或仅同领域组合不能自动判X/Y", () => {
  const input = evidenceFixture(["F1", "F2"]);
  input.documents[0].disclosures[1].evidenceText = "虚构证据";
  const [result] = classifyEvidence(input, ["D1", "D2"], sourceMap());
  assert.equal(result.category, "REVIEW_REQUIRED");
  assert.match(result.riskFlags.join(","), /EVIDENCE_TEXT_NOT_VERIFIED/);
  const combination = evidenceFixture();
  combination.combinations[0].motivationType = "SAME_FIELD_ONLY";
  assert.notEqual(
    classifyEvidence(combination, ["D1", "D2"], sourceMap())[0].category,
    "Y",
  );
});

test("模型遗漏 isInnovation 时按非创新点处理，不阻断分类保存", () => {
  const input = evidenceFixture(["F1", "F2"]);
  delete input.features[0].isInnovation;
  const [result] = classifyEvidence(input, ["D1", "D2"], sourceMap());
  assert.equal(result.category, "X");
  assert.equal(result.metrics.innovationOverlap, true);
});

test("模型把单篇文献误写为组合时忽略该组合，不阻断分类保存", () => {
  const input = evidenceFixture(["F1"], ["F2"]);
  input.combinations = [
    {
      documentIds: ["D1"],
      motivationScore: "High",
      motivationReason: "错误的单篇组合",
    },
  ];
  const [result] = classifyEvidence(input, ["D1", "D2"], sourceMap());
  assert.notEqual(result.category, "Y");
});

test("模型输出未约定的结合等级或动机类型时保守归一化", () => {
  const input = evidenceFixture();
  input.combinations[0].motivationScore = "Medium";
  input.combinations[0].motivationType = "SUPPLEMENTARY_IMPROVEMENT";
  const results = classifyEvidence(input, ["D1", "D2"], sourceMap());
  assert.deepEqual(
    results.map((item) => item.metrics.motivationScore),
    ["Low", "Low"],
  );
  assert.notEqual(results[0].category, "Y");
});

test("完整单篇X存在时，不把同一文件再放入Y组合", () => {
  const results = classifyEvidence(
    evidenceFixture(["F1", "F2"], ["F1"]),
    ["D1", "D2"],
    sourceMap(),
  );
  assert.equal(results[0].category, "X");
  assert.notEqual(results[1].category, "Y");
});

test("检索计划保留主题、核心特征、关系和语义检索通道", () => {
  const plan = buildRetrievalPlan(
    {
      inventionName: "电池热管理方法",
      technicalField: "新能源汽车",
      backgroundTechnology: "现有冷却响应慢",
      technicalProblem: "局部温差过大",
      technicalSolution: "检测单体温差并控制局部冷却",
      beneficialEffects: "提高温度一致性",
      keyTechnicalFeatures: ["温差检测", "局部冷却控制"],
      searchKeywords: ["电池热管理", "温差检测", "局部冷却"],
      ipcSuggestions: [{ code: "B60L", name: "电动车辆" }],
      sourceTextLength: 100,
    },
    {
      topic: "电池热管理方法",
      keywords: ["电池热管理", "温差检测", "局部冷却"],
      ipcCodes: ["B60L"],
      sortBy: "relevance",
      limit: 20,
      explanation: "测试",
    },
  );
  assert.ok(plan.routes.some((route) => route.purpose === "TOPIC"));
  assert.ok(plan.routes.some((route) => route.purpose === "CORE_FEATURE"));
  assert.ok(
    plan.routes.some(
      (route) => route.purpose === "TECHNICAL_RELATION" && route.keywordMatch === "all",
    ),
  );
  const semantic = plan.routes.find((route) => route.purpose === "SEMANTIC");
  assert.ok(semantic?.semanticQuery.includes("检测单体温差"));
});

test("专利检索会规范化 IPC 空格和版本号", () => {
  assert.deepEqual(
    normalizeIpcCodes([
      "G06N 3/08",
      "G06N    3/08    (2023.01)",
      "G06V 10/764",
    ]),
    ["G06N3/08", "G06V10/764"],
  );
});

test("全文字段只使用数据库实际存在的白名单列", () => {
  assert.deepEqual(
    resolvePatentTextColumns(["id", "claims", "description", "drawings"]),
    { claims: "claims", description: "description", drawings: "drawings" },
  );
  assert.deepEqual(
    resolvePatentTextColumns(["id", "claim_text"], { claims: "unknown" }),
    { claims: "claim_text" },
  );
});


const {
  parsePatentModelResponse,
  PatentModelResponseError,
  analyzePatentContent,
  summarizePatentAnalyses,
} = require("../app/api/patent/parse/service.ts");

const validPatentResult = {
  inventionName: "冷却装置", applicationType: "无法判断",
  technicalField: "电池热管理", technicalProblem: "温差较大",
  technicalSolution: "检测温度并调节泵速", technicalEffect: "减小温差",
};
const patentInput = {
  bibliographicData: "", title: "", abstract: "", description: "电池冷却材料",
  claims: "", drawings: "",
};
const validPatentSummary = {
  overview: "两份材料涉及电池冷却", commonTechnicalProblems: ["温度不均"],
  commonTechnicalSolutions: ["调节冷却流量"], technicalEffects: [],
  differences: [], searchFocus: ["电池冷却"],
};
const patentAnalyses = [
  { fileName: "a.pdf", result: validPatentResult },
  { fileName: "b.pdf", result: validPatentResult },
];

async function withPatentMock(invoke, action) {
  const { ChatOpenAI } = require("@langchain/openai");
  const original = ChatOpenAI.prototype.invoke;
  const oldKey = process.env.OPENAI_API_KEY;
  const oldError = console.error;
  const logs = [];
  process.env.OPENAI_API_KEY = "test-key";
  ChatOpenAI.prototype.invoke = invoke;
  console.error = (...args) => logs.push(args);
  try { await action(logs); }
  finally {
    ChatOpenAI.prototype.invoke = original;
    console.error = oldError;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
}
function patentResponse(value, finishReason = "stop") {
  return { content: JSON.stringify(value), response_metadata: { finish_reason: finishReason } };
}

test("专利 JSON 内容块无损拼接且忽略推理块", () => {
  const text = JSON.stringify(validPatentResult);
  const result = parsePatentModelResponse([
    { type: "reasoning", text: "推理不是最终答案" },
    { type: "text", text: text.slice(0, 30) },
    { type: "output_text", text: text.slice(30) },
  ]);
  assert.deepEqual(result, validPatentResult);
});

test("专利格式严格拒绝缺字段、错误类型、额外字段和非约定申请类型", () => {
  const missing = { ...validPatentResult };
  delete missing.technicalEffect;
  for (const value of [
    {}, missing, { ...validPatentResult, technicalSolution: ["检测温度"] },
    { ...validPatentResult, technicalField: null },
    { ...validPatentResult, inventionName: 123 },
    { ...validPatentResult, applicationType: "发明专利" },
    { ...validPatentResult, extra: "不能增加字段" },
    { data: validPatentResult }, [validPatentResult],
  ]) assert.throws(() => parsePatentModelResponse(JSON.stringify(value)), PatentModelResponseError);
  assert.deepEqual(parsePatentModelResponse(JSON.stringify({
    ...validPatentResult, technicalEffect: "",
  })), { ...validPatentResult, technicalEffect: "" });
});

test("专利格式严格拒绝空响应、截断 JSON、解释文字和代码围栏", () => {
  const text = JSON.stringify(validPatentResult);
  for (const value of [null, "", "null", text.slice(0, -1), "结果如下：" + text,
    "\x60\x60\x60json\n" + text + "\n\x60\x60\x60"]) {
    assert.throws(() => parsePatentModelResponse(value), PatentModelResponseError);
  }
});

test("单份解析和多份汇总都发送必填字段和禁止额外字段的严格 Schema", async () => {
  let calls = 0;
  await withPatentMock(async (messages, options) => {
    calls += 1;
    const format = options.response_format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.strict, true);
    const schema = format.json_schema.schema;
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort());
    if (calls === 1) {
      assert.deepEqual(schema.properties.applicationType.enum, ["发明", "实用新型", "外观设计", "无法判断"]);
      return patentResponse(validPatentResult);
    }
    assert.equal(schema.properties.commonTechnicalProblems.maxItems, 8);
    assert.equal(schema.properties.searchFocus.maxItems, 12);
    return patentResponse(validPatentSummary);
  }, async () => {
    assert.deepEqual(await analyzePatentContent(patentInput), validPatentResult);
    assert.deepEqual(await summarizePatentAnalyses(patentAnalyses), validPatentSummary);
    assert.equal(calls, 2);
  });
});

test("模型首轮格式错误时按原始材料重新生成一次并校验", async () => {
  let calls = 0;
  await withPatentMock(async (messages) => {
    calls += 1;
    if (calls === 1) return patentResponse({ inventionName: "不能补空字段" });
    assert.match(messages[0].content, /上次输出未通过格式校验/);
    assert.ok(messages.some((message) => JSON.stringify(message.content).includes("电池冷却材料")));
    return patentResponse(validPatentResult);
  }, async () => {
    assert.deepEqual(await analyzePatentContent(patentInput), validPatentResult);
    assert.equal(calls, 2);
  });
});

test("模型连续不合规时停止重试并拒绝成功结果，日志不包含原文", async () => {
  let calls = 0;
  const privateText = "私有专利原文禁止写入日志";
  await withPatentMock(async () => {
    calls += 1;
    return { content: privateText, response_metadata: { finish_reason: "stop" } };
  }, async (logs) => {
    await assert.rejects(analyzePatentContent(patentInput), PatentModelResponseError);
    assert.equal(calls, 2);
    assert.equal(logs.length, 2);
    assert.ok(!JSON.stringify(logs).includes(privateText));
  });
});

test("模型标记截断或内容过滤时即使 JSON 合法也不得通过", async () => {
  for (const reason of ["length", "content_filter"]) {
    let calls = 0;
    await withPatentMock(async () => { calls += 1; return patentResponse(validPatentResult, reason); }, async () => {
      await assert.rejects(analyzePatentContent(patentInput), PatentModelResponseError);
      assert.equal(calls, 2);
    });
  }
});

test("多份汇总拒绝超限数组、错误元素、缺字段和额外字段", async () => {
  const missing = { ...validPatentSummary };
  delete missing.overview;
  for (const bad of [
    { ...validPatentSummary, commonTechnicalProblems: Array(9).fill("问题") },
    { ...validPatentSummary, searchFocus: Array(13).fill("关键词") },
    { ...validPatentSummary, technicalEffects: [123] },
    { ...validPatentSummary, differences: "不是数组" },
    { ...validPatentSummary, extra: "额外字段" }, missing,
  ]) {
    let calls = 0;
    await withPatentMock(async () => { calls += 1; return patentResponse(bad); }, async () => {
      await assert.rejects(summarizePatentAnalyses(patentAnalyses), PatentModelResponseError);
      assert.equal(calls, 2);
    });
  }
});

test("汇总错误可重新生成一次恢复，服务商错误不会触发格式重试", async () => {
  let calls = 0;
  await withPatentMock(async () => {
    calls += 1;
    return patentResponse(calls === 1 ? {} : validPatentSummary);
  }, async () => {
    assert.deepEqual(await summarizePatentAnalyses(patentAnalyses), validPatentSummary);
    assert.equal(calls, 2);
  });
  calls = 0;
  const upstreamError = Object.assign(new Error("schema unsupported"), { status: 400 });
  await withPatentMock(async () => { calls += 1; throw upstreamError; }, async () => {
    await assert.rejects(analyzePatentContent(patentInput), (error) => error === upstreamError);
    assert.equal(calls, 1);
  });
});
