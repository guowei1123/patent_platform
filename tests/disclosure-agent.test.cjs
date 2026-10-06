const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const AdmZip = require("adm-zip");
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
  stateSchema,
} = require("../src/mastra/disclosure/contracts.ts");
const {
  applyModelResult,
  checkDisclosure,
} = require("../src/mastra/disclosure/quality.ts");
const { exportDisclosure } = require("../src/mastra/disclosure/export.ts");
const { imageSize } = require("../src/mastra/disclosure/images.ts");
const {
  sectionImpactsFor,
  mergeSectionImpacts,
} = require("../src/mastra/disclosure/dependencies.ts");
const command = (action, extra = {}) =>
  commandSchema.parse({
    action,
    baseVersion: 0,
    operationId: crypto.randomUUID(),
    message: "测试",
    ...extra,
  });
const result = (extra = {}) => ({
  reply: "已整理",
  facts: [],
  questions: [],
  patches: [],
  issues: [],
  ...extra,
});

test("来源不匹配的模型事实不会进入底稿", () => {
  const state = initialState();
  state.sources = [{ id: "s1", label: "原始材料", text: "检测电池温差" }];
  const next = applyModelResult(
    state,
    result({
      facts: [
        {
          category: "技术手段",
          text: "检测温差",
          sourceId: "s1",
          quote: "检测电池温差",
        },
        {
          category: "效果依据",
          text: "提升30%",
          sourceId: "s1",
          quote: "提升30%",
        },
      ],
    }),
    command("message"),
  );
  assert.equal(next.facts.length, 1);
  assert.equal(state.facts.length, 0);
});

test("模型将申请类型写成待补充句子时不阻断其他章节生成", () => {
  const next = applyModelResult(
    initialState(),
    result({
      patches: [
        {
          section: "applicationType",
          content: "【申请类型】待补充（发明/实用新型）",
          reason: "信息缺失",
        },
        {
          section: "technicalSolution",
          content: "依据温差控制泵速",
          reason: "整理",
        },
      ],
    }),
    command("draft"),
  );
  assert.equal(next.sections.applicationType, "");
  assert.equal(next.sections.technicalSolution, "");
  assert.ok(next.issues.some((issue) => issue.message.includes("已拦截")));
  assert.equal(stateSchema.safeParse(next).success, true);
});
test("缺少实验依据的百分比被拦截，不写入正文或建议", () => {
  const state = initialState();
  state.sections.technicalSolution =
    "温度传感器采集温度，控制器比较温差并调节水泵转速。";
  state.sections.beneficialEffects = "改善温度控制。";
  state.sources = ["technicalSolution", "beneficialEffects"].map((section) => ({
    id: section,
    label: `用户编辑：${section}`,
    text: state.sections[section],
  }));
  const next = applyModelResult(
    state,
    result({
      patches: [
        {
          section: "beneficialEffects",
          content: "效率提升30%",
          reason: "补充效果",
        },
      ],
    }),
    command("draft"),
  );
  assert.equal(next.sections.beneficialEffects, "改善温度控制。");
  assert.equal(next.suggestions.length, 0);
  assert.ok(next.issues.some((i) => i.message.includes("已拦截")));
});
test("手工编辑章节保留原文，质量检查不丢失候选建议", () => {
  const state = initialState();
  state.sections.technicalSolution =
    "温度传感器进行采集模组温度，控制器进行比较温差并调节水泵转速。";
  state.sources = [
    {
      id: "original",
      label: "用户编辑：technicalSolution",
      text: state.sections.technicalSolution,
    },
  ];
  state.lockedSections = ["technicalSolution"];
  const next = applyModelResult(
    state,
    result({
      patches: [
        {
          section: "technicalSolution",
          content: "温度传感器采集模组温度；控制器比较温差并调节水泵转速。",
          reason: "语言整理",
        },
      ],
    }),
    command("revise", { section: "technicalSolution" }),
  );
  assert.equal(
    next.sections.technicalSolution,
    state.sections.technicalSolution,
  );
  assert.equal(
    next.suggestions[0].content,
    "温度传感器采集模组温度；控制器比较温差并调节水泵转速。",
  );
  const checked = applyModelResult(next, result(), command("check"));
  assert.equal(checked.suggestions.length, 1);
});
test("局部修订不自动覆盖其他章节", () => {
  const state = initialState();
  state.sections.techBackground = "原背景";
  state.sections.technicalSolution =
    "温度传感器采集温度，控制器比较温差并调节水泵转速。";
  state.sources = ["technicalSolution", "techBackground"].map((section) => ({
    id: section,
    label: `用户编辑：${section}`,
    text: state.sections[section],
  }));
  const next = applyModelResult(
    state,
    result({
      patches: [
        {
          section: "technicalSolution",
          content: "修改后的方案",
          reason: "按要求修改",
        },
        { section: "techBackground", content: "相关背景建议", reason: "联动" },
      ],
    }),
    command("revise", { section: "technicalSolution" }),
  );
  assert.equal(next.sections.techBackground, "原背景");
  assert.equal(
    next.sections.technicalSolution,
    state.sections.technicalSolution,
  );
  assert.equal(next.suggestions[0].section, "techBackground");
});
test("未完成图片检测明确报告，非法申请类型无法保存", () => {
  const state = initialState();
  state.images = [
    {
      id: crypto.randomUUID(),
      name: "a.png",
      caption: "",
      detection: "failed",
      reason: "未完成检查",
    },
  ];
  assert.ok(
    checkDisclosure(state).some((i) => i.message.includes("未完成检查")),
  );
  assert.ok(
    checkDisclosure(state).some((i) => i.message.includes("缺少附图说明")),
  );
  assert.equal(
    stateSchema.safeParse({
      ...state,
      sections: { ...state.sections, applicationType: "自动选择" },
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      action: "edit",
      operationId: crypto.randomUUID(),
      baseVersion: 1,
    }).success,
    false,
  );
});
test("PNG 尺寸检测拒绝非图片和超大图片", () => {
  assert.throws(() => imageSize(Buffer.from("not an image")));
  const data = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.writeUInt32BE(100000, 16);
  data.writeUInt32BE(100000, 20);
  assert.throws(() => imageSize(data), /尺寸/);
});
test("章节联动仅标记受影响章节，不改写正文", () => {
  const state = initialState();
  state.sections.technicalSolution = "原技术方案";
  state.sections.beneficialEffects = "原有益效果";
  const impacts = sectionImpactsFor("technicalSolution");
  state.sectionImpacts = mergeSectionImpacts([], impacts);
  assert.equal(state.sections.beneficialEffects, "原有益效果");
  assert.ok(
    state.sectionImpacts.some(
      (item) => item.affectedSection === "beneficialEffects",
    ),
  );
  assert.ok(
    checkDisclosure(state).some((item) => item.message.includes("有益效果")),
  );
});
test("检索专利与用户材料分离保存", () => {
  const state = initialState();
  state.patentSearches = [
    {
      id: crypto.randomUUID(),
      keywords: ["温差控制"],
      total: 1,
      items: [
        {
          id: "patent-1",
          docNumber: "CN100000001A",
          kind: "A",
          title: "检索专利",
          abstract: "外部摘要",
          pubDate: "2024-01-01",
          applicant: "申请人",
          ipcCodes: [],
        },
      ],
      searchedAt: new Date().toISOString(),
    },
  ];
  assert.equal(state.sources.length, 0);
  assert.equal(state.sections.technicalSolution, "");
  assert.equal(stateSchema.safeParse(state).success, true);
});
test("Word 导出绑定版本并嵌入图片、关系、图号与复核事项", async () => {
  const state = initialState();
  state.sections.inventionName = "测试<&>";
  state.sections.technicalSolution = "检测温差并调节冷却流量";
  const data = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
    "base64",
  );
  state.images = [
    {
      id: crypto.randomUUID(),
      name: "test.png",
      caption: "冷却流程<&>",
      detection: "passed",
      reason: "通过",
    },
  ];
  state.questions = ["请补充控制规则"];
  state.keywords = [{ term: "温度传感器", definition: "测量温度的器件" }];
  const zip = new AdmZip(
    await exportDisclosure(state, [{ data, mime: "image/png" }], 3),
  );
  const xml = zip.readAsText("word/document.xml");
  assert.match(xml, /交底书版本：3/);
  assert.match(xml, /图1 冷却流程&lt;&amp;&gt;/);
  assert.match(xml, /请补充控制规则/);
  assert.match(xml, /关键术语释义/);
  assert.match(xml, /温度传感器：测量温度的器件/);
  assert.ok(zip.getEntry("word/media/disclosure-1.png"));
  assert.match(
    zip.readAsText("word/_rels/document.xml.rels"),
    /media\/disclosure-1.png/,
  );
  assert.ok(xml.indexOf("交底书版本：3") < xml.lastIndexOf("<w:sectPr"));
  assert.equal(xml.includes("{{技术方案}}"), false);
  await assert.rejects(() => exportDisclosure(state, [], 3), /附图不完整/);
});

test(
  "本地接口：保存、幂等、并发冲突、恢复、导出和任务隔离",
  { skip: !process.env.DISCLOSURE_TEST_URL, timeout: 120000 },
  async () => {
    const base = process.env.DISCLOSURE_TEST_URL;
    let cookie = "",
      conversationId;
    async function call(path, body) {
      const response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const set = response.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return response;
    }
    try {
      let response = await call("/api/agent/disclosures", {
        title: "自动化验收临时交底书",
      });
      assert.equal(response.status, 201, await response.clone().text());
      let { task } = await response.json();
      conversationId = task.conversationId;
      const path = `/api/agent/disclosures/${task.id}`;
      const edit = command("edit", {
        section: "technicalSolution",
        content: "读取温度传感器输出，根据温差调节冷却流量。",
      });
      response = await call(path, edit);
      assert.equal(response.status, 200, await response.clone().text());
      task = (await response.json()).task;
      assert.equal(task.version, 1);
      response = await call(path, edit);
      assert.equal((await response.json()).task.version, 1);
      response = await call(path, {
        ...edit,
        operationId: crypto.randomUUID(),
      });
      assert.equal(response.status, 409);
      const concurrent = await Promise.all([
        call(
          path,
          command("edit", {
            baseVersion: 1,
            section: "inventionName",
            content: "电池冷却方法",
          }),
        ),
        call(
          path,
          command("edit", {
            baseVersion: 1,
            section: "inventionName",
            content: "温差控制方法",
          }),
        ),
      ]);
      assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
      response = await call(path);
      task = (await response.json()).task;
      assert.equal(task.version, 2);
      const foreign = await fetch(base + path);
      assert.equal(foreign.status, 404);
      const document = await call(path + "/export?version=1");
      assert.equal(document.status, 200);
      const zip = new AdmZip(Buffer.from(await document.arrayBuffer()));
      assert.match(zip.readAsText("word/document.xml"), /读取温度传感器/);
      response = await call(
        path,
        command("restore", { baseVersion: 2, restoreVersion: 0 }),
      );
      task = (await response.json()).task;
      assert.equal(task.version, 3);
      assert.equal(task.state.sections.technicalSolution, "");
      response = await call(path);
      assert.equal((await response.json()).task.version, 3);
    } finally {
      if (conversationId)
        await fetch(base + `/api/agent/conversations/${conversationId}`, {
          method: "DELETE",
          headers: { cookie },
        });
    }
  },
);

test(
  "真实模型与文件：DOCX 导入、生成、图片保存、版本导出",
  { skip: !process.env.DISCLOSURE_MODEL_TEST, timeout: 600000 },
  async () => {
    const base = process.env.DISCLOSURE_TEST_URL || "http://localhost:3001";
    let cookie = "",
      conversationId;
    const call = async (path, body) => {
      const response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(body
          ? { body: body instanceof FormData ? body : JSON.stringify(body) }
          : {}),
      });
      const set = response.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return response;
    };
    try {
      let response = await call("/api/agent/disclosures", {
        title: "模型文件闭环验收",
      });
      assert.equal(response.status, 201);
      let { task } = await response.json();
      conversationId = task.conversationId;
      const path = `/api/agent/disclosures/${task.id}`;
      const sample = initialState();
      Object.assign(sample.sections, {
        inventionName: "模组温差液冷控制方法",
        technicalField: "新能源汽车电池热管理",
        techBackground: "恒定泵速无法根据模组温差调节。",
        technicalSolution:
          "四个模组各布置一个温度传感器，每秒采样一次。控制器计算最高温度与最低温度的差，温差大于5摄氏度时将泵PWM占空比设为80%，小于3摄氏度时设为40%，其他情况保持原值。初始占空比40%。冷却液经过模组底部冷板回流。暂未确定PWM频率及控制器型号。",
        beneficialEffects:
          "通过回差控制减少泵速频繁切换。没有节能比例等实测数据。",
      });
      const form = new FormData();
      form.set("operationId", crypto.randomUUID());
      form.set("baseVersion", "0");
      form.set(
        "file",
        new Blob([await exportDisclosure(sample, [], 0)]),
        "测试材料.docx",
      );
      response = await call(path + "/upload", form);
      assert.equal(response.status, 200, await response.clone().text());
      task = (await response.json()).task;
      assert.ok(
        task.state.sources.some(
          (source) =>
            source.label === "测试材料.docx" &&
            source.text.includes("四个模组"),
        ),
      );
      response = await call(
        path,
        command("edit", {
          baseVersion: task.version,
          section: "technicalSolution",
          content: sample.sections.technicalSolution,
        }),
      );
      assert.equal(response.status, 200, await response.clone().text());
      task = (await response.json()).task;
      response = await call(
        path,
        command("draft", {
          baseVersion: task.version,
          message: "请生成完整交底书初稿，未知项保留待补充，不得编造实验数据。",
        }),
      );
      assert.equal(response.status, 200, await response.clone().text());
      task = (await response.json()).task;
      assert.ok(
        task.state.sections.technicalSolution.length > 50,
        "必须保留用户提供的技术方案正文",
      );
      assert.ok(task.state.sections.inventionName.length > 0);
      assert.equal(
        /\d+(?:\.\d+)?[%％]/.test(task.state.sections.beneficialEffects),
        false,
        "不得生成未经提供的效果百分比",
      );
      const image = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
        "base64",
      );
      const upload = new FormData();
      upload.set("operationId", crypto.randomUUID());
      upload.set("baseVersion", String(task.version));
      upload.set("caption", "图片封装验收图");
      upload.set("file", new Blob([image], { type: "image/png" }), "验收.png");
      response = await call(path + "/upload", upload);
      assert.equal(response.status, 200, await response.clone().text());
      task = (await response.json()).task;
      assert.equal(task.state.images.length, 1);
      const restored = await call(path);
      assert.equal(
        (await restored.json()).task.state.images[0].caption,
        "图片封装验收图",
      );
      const asset = await call(path + "/assets/" + task.state.images[0].id);
      assert.equal(asset.status, 200);
      assert.deepEqual(Buffer.from(await asset.arrayBuffer()), image);
      response = await call(path + `/export?version=${task.version}`);
      assert.equal(response.status, 200);
      const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
      assert.ok(zip.getEntry("word/media/disclosure-1.png"));
    } finally {
      if (conversationId)
        await fetch(base + `/api/agent/conversations/${conversationId}`, {
          method: "DELETE",
          headers: { cookie },
        });
    }
  },
);
