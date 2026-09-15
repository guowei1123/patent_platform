# 专利交底书智能体（第一期）

入口：`/disclosure`。从问答、检索或报告页面的侧栏“交底书撰写”也可进入。

## 使用方式

1. 描述想法、粘贴技术方案，或上传 DOCX 正文材料。助手整理带原文引证的技术事实，每轮最多提出三个关键问题。
2. 点击“生成初稿”，依据当前材料形成完整章节。未知实施信息保留待补充标记，不生成未经材料支持的效果百分比。
3. 选择章节，输入要求后点击“修改本章”；相关章节的修改作为建议展示。手工保存过的章节始终保留原文，AI 修改须点击“采用建议”。
4. “质量检查”核实章节完整性、术语和参数、效果依据及保护点支持；检查结果可点击定位章节。
5. 图片单独上传并填写附图说明，支持 PNG/JPEG；原图保存在任务数据库中，刷新后恢复。
6. 预览后导出 Word。导出绑定当前已保存版本，含附图、图号和待复核事项。历史版本可恢复为新版本。

## 数据与执行

- 复用已有 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_CHAT_MODEL`；图片格式检测使用 `OPENAI_VISION_MODEL`。
- 复用 Mastra PostgreSQL 配置，新增表在首次访问时自动创建，无需手动执行迁移脚本。数据库角色需要建表权限。
- `disclosure_tasks` 保存状态、版本、执行租约及失败请求；`disclosure_versions` 保存历史快照；`disclosure_assets` 保存原图。
- 任务按现有匿名会话隔离，活动后延长 30 天保存期限；清除浏览器身份 Cookie 后无法继续访问原匿名任务。
- 每次写入携带 `baseVersion` 和 `operationId`。提交与版本快照原子完成，旧版本不能覆盖新版本，重复提交不重复保存。
- 生成失败保留原文稿。运行中断后租约最多四分钟到期，刷新后可重试；材料处理失败可重新上传原文件。
- 文稿存储独立于模型对话记忆。章节手工编辑、建议采用和版本恢复均保存新版本。

## 接口

| 接口                                              | 用途                                       |
| ------------------------------------------------- | ------------------------------------------ |
| `GET/POST /api/agent/disclosures`                 | 列表、创建                                 |
| `GET /api/agent/disclosures/:id`                  | 恢复任务和进度                             |
| `POST /api/agent/disclosures/:id`                 | 补充、生成、检查、编辑、采用建议、恢复版本 |
| `POST /api/agent/disclosures/:id/upload`          | DOCX / PNG / JPEG 上传                     |
| `GET /api/agent/disclosures/:id/assets/:assetId`  | 带任务归属校验的原图                       |
| `GET /api/agent/disclosures/:id/export?version=N` | 导出指定版本                               |

## 验证命令

```powershell
pnpm exec tsc --noEmit --incremental false
node --test --test-isolation=none tests/disclosure-agent.test.cjs
node --test --test-isolation=none tests/report-agent.test.cjs
node --test --test-isolation=none tests/rag.test.cjs
pnpm build
```

开发服务启动后，可选择运行真实数据库接口验收：

```powershell
$env:DISCLOSURE_TEST_URL = 'http://localhost:3001'
node --test tests/disclosure-agent.test.cjs
```

额外设置 `DISCLOSURE_MODEL_TEST=1` 可运行真实模型及 DOCX/图片闭环测试，会调用已配置的模型。测试使用合成材料，自动清理自身创建的临时会话。

## 第一期边界

- 单文件最大 10 MB，最多 10 张图片，累计文字材料最大 15 万字。
- DOCX 当前提取正文，内嵌图片需单独上传；PDF 和自动生成附图未纳入第一期。
- 图片检测只检查背景和线条格式，不代表已完成图文语义一致性审查。
- 事实引文验证和百分比拦截是规则检查，术语、参数、效果机制等由模型辅助检查，仍应复核技术内容。
- 不进行授权判断，不自动拼接检索文献中的技术特征。检索联动和深度图文检查留待后续阶段。
