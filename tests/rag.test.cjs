const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

// 仅测试加载器转译本地 TS；不生成文件、不需要模型/数据库凭据。
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    filename,
  );
};
const { getRagConfig } = require("../lib/rag/config.ts");
const { retrieveContext, selectContext } = require("../lib/rag/pipeline.ts");
const env = {
  QA_RAG_ENABLED: "true",
  WEKNORA_BASE_URL: "http://localhost:8080/",
  WEKNORA_API_KEY: "test-key",
  WEKNORA_KNOWLEDGE_BASE_IDS: "kb-a,kb-b,kb-a",
};
const config = () => getRagConfig(env);
const chunk = (id, content = "专利交底书应说明技术问题和技术方案。") => ({
  id,
  knowledge_id: "doc",
  knowledge_title: "交底书规范",
  content,
  score: 0.8,
});
const response = (data) =>
  new Response(JSON.stringify({ success: true, data }), { status: 200 });

test("配置显式启用、完整校验和库 ID 去重", () => {
  assert.equal(getRagConfig({}), null);
  assert.deepEqual(config().knowledgeBaseIds, ["kb-a", "kb-b"]);
  assert.equal(config().baseUrl, "http://localhost:8080");
  for (const patch of [
    { WEKNORA_API_KEY: "" },
    { QA_RAG_TOP_K: "NaN" },
    { WEKNORA_BASE_URL: "file:///secret" },
    { QA_RERANK_URL: "http://localhost/rerank" },
  ])
    assert.throws(() => getRagConfig({ ...env, ...patch }));
});

test("禁用时不访问服务，并明确说明未检索", async () => {
  const result = await retrieveContext("问题", null, () => {
    throw Error("不应请求");
  });
  assert.equal(result.status, "disabled");
  assert.match(result.context, /未启用/);
});

test("各知识库独立请求、双路召回、保留上下文补全及中文去重", async () => {
  const calls = [];
  const result = await retrieveContext(
    "交底书怎么写",
    config(),
    async (url, init) => {
      calls.push({ url, init });
      return response([
        chunk("c1"),
        chunk("c2", "专利交底书应说明技术问题和技术方案。"),
        chunk("c3", "附图须清晰，编号与正文保持一致。"),
      ]);
    },
  );
  assert.equal(calls.length, 2);
  assert.match(
    calls[0].url,
    /\/api\/v1\/knowledge-bases\/kb-a\/hybrid-search$/,
  );
  assert.equal(calls[0].init.headers["X-API-Key"], "test-key");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.disable_keywords_match, false);
  assert.equal(body.disable_vector_match, false);
  assert.equal(body.skip_context_enrichment, false);
  assert.equal(body.knowledge_base_ids, undefined);
  assert.equal(result.sources.length, 2);
  assert.deepEqual(
    result.sources.map((item) => item.number),
    [1, 2],
  );
  assert.equal(result.status, "ready");
});

test("空数据与 null 数据均明确返回无依据", async () => {
  for (const data of [[], null]) {
    const result = await retrieveContext("问题", config(), async () =>
      response(data),
    );
    assert.equal(result.status, "empty");
    assert.equal(result.sources.length, 0);
  }
});

test("检索失败、错误契约和超时不得伪装为无结果", async () => {
  await assert.rejects(
    retrieveContext(
      "问题",
      config(),
      async () => new Response("失败", { status: 503 }),
    ),
    /503/,
  );
  await assert.rejects(
    retrieveContext(
      "问题",
      config(),
      async () => new Response('{"success":false,"data":[]}'),
    ),
    /无效数据/,
  );
  await assert.rejects(
    retrieveContext("问题", config(), async () => {
      throw new DOMException("超时", "TimeoutError");
    }),
    /超时/,
  );
});

test("上下文预算限制序列化大小，编号连续，展示文本与证据一致", () => {
  const sources = Array.from({ length: 10 }, (_, i) => ({
    id: `${i}`,
    number: 0,
    knowledgeBaseId: "a",
    knowledgeId: "d",
    title: "资料",
    content: `${i}技术细节` + '\n"中文'.repeat(2000),
    score: 1 / (i + 1),
  }));
  const result = selectContext(sources, { topK: 6, maxContextChars: 1500 });
  assert.ok(result.length > 0);
  assert.ok(JSON.stringify(result).length <= 1500);
  assert.ok(result.every((item) => item.content.length > 0));
  assert.deepEqual(
    result.map((item) => item.number),
    result.map((_, i) => i + 1),
  );
});

test("可选模型重排采用模型返回顺序且校验下标", async () => {
  const cfg = {
    ...config(),
    knowledgeBaseIds: ["a"],
    topK: 1,
    rerank: {
      url: "http://localhost/rerank",
      apiKey: "rank-key",
      model: "reranker",
    },
  };
  const result = await retrieveContext("附图", cfg, async (url, init) => {
    if (url.endsWith("/rerank")) {
      assert.equal(init.headers.Authorization, "Bearer rank-key");
      assert.equal(JSON.parse(init.body).documents.length, 2);
      return new Response(
        JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.99 },
            { index: 0, relevance_score: 0.1 },
          ],
        }),
      );
    }
    return response([chunk("c1"), chunk("c2", "附图中的符号编号须统一。")]);
  });
  assert.equal(result.sources[0].id, "c2");
  await assert.rejects(
    retrieveContext("问题", cfg, async (url) =>
      url.endsWith("/rerank")
        ? new Response('{"results":[{"index":99,"relevance_score":1}]}')
        : response([chunk("c1")]),
    ),
    /无效数据/,
  );
});
