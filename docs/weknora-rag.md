# 通用问答接入 WeKnora

本项目复用 WeKnora 的文档处理和混合检索 API，保留现有 Mastra 模型、对话记忆与专利检索审批流程。适配依据为 WeKnora `01377b686c7fa320acb162531c1fbcd786e8da6c` 的 `POST /api/v1/knowledge-bases/:id/hybrid-search`。

## 启用

1. 部署 [WeKnora](https://github.com/Tencent/WeKnora)，在其管理界面配置解析器、Embedding 模型和检索存储。
2. 建立通用问答知识库，上传专利流程、交底书规范、系统使用说明等材料，等待文档完成索引。建议开启向量和关键词索引，并根据文档结构启用父子切块。
3. 在本项目服务端环境中设置 `QA_RAG_ENABLED=true`、`WEKNORA_BASE_URL`（服务根地址）、`WEKNORA_API_KEY` 和 `WEKNORA_KNOWLEDGE_BASE_IDS`（逗号分隔）。配置项见 `.env.example`，重启 Next.js 后生效。
4. 在首页选择问答并提出资料中的问题，检查回答下方的“检索参考资料”，展开核对片段；重新打开历史会话应仍能查看来源。

本平台当前以匿名会话隔离历史。环境变量中的知识库属于平台共享知识范围，只应绑定所有问答用户都可读取的资料；服务端不接受浏览器传入知识库 ID 或 API Key。私有用户知识库需要先接入账户授权和逐用户知识范围。

## 问答链路

对话历史辅助改写问题 → 各知识库并行混合检索 → 跨库排名归一 → 可选模型重排 → MMR 去冗余 → 长度预算 → Mastra 流式回答。

- WeKnora 负责解析、切块、索引及库内向量/关键词融合。适配请求保留父块和邻块补全（`skip_context_enrichment=false`）。
- 不同库分别请求，避免跨 Embedding 模型使用同一向量查询；跨库按 `1/(60+rank)` 排序，不直接比较不同引擎的原始得分。
- 配置 `QA_RERANK_URL`、`QA_RERANK_API_KEY`、`QA_RERANK_MODEL` 后调用兼容 Cohere 格式的重排服务；不配置则保留召回排名，随后做中文双字片段/英文词 Jaccard MMR。
- 改写失败回退原问题；检索或已配置的重排服务失败则本轮报错，避免将故障伪装为已完成的知识库回答。
- 检索为空时明确提示缺少依据；未启用时明确显示知识库未启用。
- 资料通过本轮上下文传入，不覆盖用户原始问题；提示词要求引用真实来源编号并忽略资料中的指令。来源内容按同一预算同时用于回答和展示。
- `mastra_agent.qa_message_sources` 自动建表，按会话与回答消息 ID 保存来源；读取检查会话归属，删除/过期清理会话时级联删除。

本次没有接入 GraphRAG、Wiki 编译或 WeKnora Agent；这些并非 hybrid-search API 的完整能力。资料上传与索引管理使用 WeKnora 管理端。旧版 `/test/qa` 同样复用检索上下文，主页面额外提供可展开的结构化来源。

## 验证

运行 `node --test tests/rag.test.cjs` 验证请求契约、配置、空结果、服务失败、重排和上下文预算；运行 `pnpm exec tsc --noEmit` 检查类型。真实端到端测试需要已运行的 WeKnora、已索引知识库、模型和项目 PostgreSQL 服务。
