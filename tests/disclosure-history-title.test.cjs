const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { randomUUID } = require("node:crypto");

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

test(
  "交底书默认标题随发明名称保存并刷新，手动重命名不被覆盖",
  {
    skip: !process.env.DISCLOSURE_TITLE_DB_TEST,
    timeout: 30000,
  },
  async () => {
    const { loadEnvConfig } = require("@next/env");
    const { Client } = require("pg");
    loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
    const config = process.env.MASTRA_DATABASE_URL
      ? { connectionString: process.env.MASTRA_DATABASE_URL }
      : {
          host: process.env.POSTGRES_HOST || "localhost",
          port: Number(process.env.POSTGRES_PORT || 5432),
          database: process.env.POSTGRES_DB || "vectordb",
          user: process.env.POSTGRES_USER || "postgres",
          password: process.env.POSTGRES_PASSWORD || "password",
          ssl:
            process.env.POSTGRES_SSL === "true"
              ? { rejectUnauthorized: false }
              : false,
        };
    const client = new Client({
      ...config,
      connectionTimeoutMillis: 4000,
      query_timeout: 5000,
    });
    const root = path.resolve(__dirname, "..");
    const resourceId = `title-test:${randomUUID()}`;
    const exec = (sql, params) =>
      client.query(sql.replaceAll("mastra_agent.", "pg_temp."), params);
    const storage = {
      ensureMastraStore: async () => {},
      mastraStore: {
        db: {
          none: async (sql, params) => {
            await exec(sql, params);
          },
          one: async (sql, params) => {
            const { rows } = await exec(sql, params);
            assert.equal(rows.length, 1);
            return rows[0];
          },
          oneOrNone: async (sql, params) =>
            (await exec(sql, params)).rows[0] || null,
          any: async (sql, params) => (await exec(sql, params)).rows,
        },
      },
    };
    const originalLoad = Module._load;
    const touched = [];
    Module._load = function (request, parent, ...rest) {
      if (parent?.filename?.startsWith(root)) {
        if (["./storage", "../storage"].includes(request)) return storage;
        if (request === "./memory")
          return { patentMemory: { deleteThread: async () => {} } };
        if (request === "@/src/mastra/anonymous-session")
          return { getAnonymousResourceId: async () => resourceId };
        if (request.startsWith("@/"))
          request = path.join(root, request.slice(2)) + ".ts";
      }
      return originalLoad.call(this, request, parent, ...rest);
    };
    const fresh = (relative) => {
      const filename = path.join(root, relative);
      delete require.cache[filename];
      touched.push(filename);
      return require(filename);
    };
    try {
      await client.connect();
      await client.query("BEGIN");
      await client.query(
        "CREATE TEMP TABLE disclosure_title_test_anchor (value INTEGER)",
      );
      const conversations = fresh("src/mastra/conversation-service.ts");
      const tasks = fresh("src/mastra/disclosure/task-service.ts");
      const {
        commandSchema,
      } = require("../src/mastra/disclosure/contracts.ts");
      const {
        saveDisclosureWritingStep,
      } = require("../src/mastra/disclosure/writing-flow.ts");
      const history = fresh("app/api/agent/conversations/route.ts");
      const rename = fresh("app/api/agent/conversations/[id]/route.ts");
      const ordinary = await conversations.createConversation(
        resourceId,
        "qa",
        "普通问答名称",
      );
      const conversation = await conversations.createConversation(
        resourceId,
        "disclosure",
        "新交底书",
      );
      let task = await tasks.createDisclosureTask(resourceId, conversation.id);
      const save = async (sections) => {
        const command = commandSchema.parse({
          action: "save-step",
          operationId: randomUUID(),
          baseVersion: task.version,
          sections,
        });
        assert.ok(await tasks.claimDisclosure(resourceId, task.id, command));
        task = await tasks.commitDisclosure(
          resourceId,
          task.id,
          command,
          saveDisclosureWritingStep(task.state, command),
        );
      };
      const title = async () =>
        (await conversations.getConversation(resourceId, conversation.id))
          .title;
      assert.equal(await title(), "新交底书");
      await save({ contactPerson: "测试联系人" });
      assert.equal(await title(), "新交底书");
      await save({ inventionName: " 电池温控装置 " });
      assert.equal(await title(), "电池温控装置");
      await save({ inventionName: "改进的电池温控装置" });
      assert.equal(await title(), "改进的电池温控装置");
      const list = async () => {
        const response = await history.GET(
          new Request("http://localhost/api/agent/conversations"),
        );
        assert.equal(response.status, 200);
        return (await response.json()).items;
      };
      assert.equal(
        (await list()).find((item) => item.id === conversation.id).title,
        "改进的电池温控装置",
      );
      assert.equal(
        (await list()).find((item) => item.id === ordinary.id).title,
        "普通问答名称",
      );
      const longName = "发明".repeat(50);
      await save({ inventionName: longName });
      assert.equal(await title(), longName.slice(0, 80));
      assert.equal(task.state.sections.inventionName, longName);
      await save({ inventionName: "   " });
      assert.equal(await title(), "新交底书");
      await save({ inventionName: "供历史恢复的发明名称" });
      // 旧记录即使存着创建时的默认标题，历史查询也显示已保存的发明名称。
      await exec(
        "UPDATE mastra_agent.agent_conversations SET title=$2 WHERE id=$1",
        [conversation.id, "旧默认标题"],
      );
      assert.equal(
        (await list()).find((item) => item.id === conversation.id).title,
        "供历史恢复的发明名称",
      );
      const response = await rename.PATCH(
        new Request(
          "http://localhost/api/agent/conversations/" + conversation.id,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "供历史恢复的发明名称" }),
          },
        ),
        { params: Promise.resolve({ id: conversation.id }) },
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).titleIsCustom, true);
      await save({ inventionName: "手动命名后的新发明名称" });
      assert.equal(await title(), "供历史恢复的发明名称");
      assert.equal(
        (await list()).find((item) => item.id === conversation.id).title,
        "供历史恢复的发明名称",
      );
      assert.equal(
        (await tasks.listDisclosureTasks(resourceId))[0].title,
        "供历史恢复的发明名称",
      );
      assert.equal(
        await conversations.updateConversation("other-user", conversation.id, {
          title: "越权改名",
          titleIsCustom: true,
        }),
        null,
      );
      assert.deepEqual(
        await tasks.listDisclosureTasks("other-user", [conversation.id]),
        [],
      );
    } finally {
      Module._load = originalLoad;
      touched.forEach((filename) => delete require.cache[filename]);
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
  },
);
