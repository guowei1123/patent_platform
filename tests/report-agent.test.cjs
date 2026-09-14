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
