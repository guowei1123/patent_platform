import { mastra } from "../index";
import { stateSchema, type DisclosureCommand } from "./contracts";
import { mergeSectionImpacts, sectionImpactsFor } from "./dependencies";
import { crossCheckDisclosureImage } from "./image-cross-check";
import {
  analyzeDisclosurePatentEvidence,
  runDisclosurePatentSearch,
} from "./patent-search";
import { checkDisclosure } from "./quality";
import {
  claimDisclosure,
  commitDisclosure,
  failDisclosure,
  getDisclosureTask,
  getDisclosureVersion,
  getDisclosureAsset,
} from "./task-service";

export class DisclosureRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function executeDisclosure(
  resourceId: string,
  id: string,
  command: DisclosureCommand,
) {
  const current = await getDisclosureTask(resourceId, id);
  if (!current) throw new DisclosureRequestError("交底书不存在或已过期", 404);
  if (current.lastOperationId === command.operationId) return current;
  const task = await claimDisclosure(resourceId, id, command);
  if (!task)
    throw new DisclosureRequestError(
      "任务正在处理或版本已更新，请重新加载后继续",
      409,
    );
  try {
    let state = stateSchema.parse(task.state);
    if (command.source) state.sources.push(command.source);
    if (command.images?.length) state.images.push(...command.images);
    if (command.message) {
      state.sources.push({
        id: command.operationId,
        label: "用户补充",
        text: command.message,
      });
      state.messages.push({
        id: command.operationId,
        role: "user",
        text: command.message,
      });
    }
    if (
      state.sources.reduce((sum, source) => sum + source.text.length, 0) >
      150000
    )
      throw new DisclosureRequestError(
        "累计材料超过 15 万字，请新建任务并使用精简材料",
        413,
      );
    if (["message", "draft", "revise", "check"].includes(command.action)) {
      stateSchema.parse(state);
      const run = await mastra.getWorkflow("disclosureWorkflow").createRun();
      const result = await run.start({ inputData: { state, command } });
      if (result.status !== "success") throw new Error("交底书生成步骤失败");
      state = stateSchema.parse(result.result);
    } else {
      if (command.action === "restore") {
        const snapshot = await getDisclosureVersion(
          resourceId,
          id,
          command.restoreVersion!,
        );
        if (!snapshot) throw new DisclosureRequestError("历史版本不存在", 404);
        state = stateSchema.parse(snapshot);
      }
      if (command.action === "edit" || command.action === "accept") {
        const section = command.section!;
        const content =
          command.action === "edit"
            ? command.content!
            : state.suggestions.find((p) => p.section === section)?.content;
        if (content === undefined)
          throw new DisclosureRequestError("修改建议已失效", 409);
        Object.assign(state.sections, { [section]: content });
        if (!state.lockedSections.includes(section))
          state.lockedSections.push(section);
        state.suggestions = state.suggestions.filter(
          (p) => p.section !== section,
        );
        if (command.action === "edit")
          state.sources.push({
            id: command.operationId,
            label: `用户编辑：${section}`,
            text: content,
          });
        state.questions = [];
        state.sectionImpacts = mergeSectionImpacts(
          state.sectionImpacts.filter(
            (impact) => impact.affectedSection !== section,
          ),
          sectionImpactsFor(section),
        );
      }
      if (command.action === "image") state.images.push(command.image!);
      if (command.action === "remove-image")
        state.images = state.images.filter(
          (image) => image.id !== command.imageId,
        );
      if (command.action === "check-images") {
        if (!state.images.length)
          throw new DisclosureRequestError("请先上传至少一张附图", 400);
        state.images = await Promise.all(
          state.images.map(async (image) => {
            const asset = await getDisclosureAsset(resourceId, id, image.id);
            if (!asset)
              return {
                ...image,
                review: {
                  status: "failed" as const,
                  summary: "图片原文件不存在，无法完成图文交叉检查",
                  detectedLabels: [],
                  issues: ["请重新上传该附图后再检查。"],
                },
              };
            try {
              return {
                ...image,
                review: await crossCheckDisclosureImage({
                  imageUrl: `data:${asset.mime};base64,${asset.data.toString("base64")}`,
                  caption: image.caption,
                  technicalSolution: state.sections.technicalSolution,
                }),
              };
            } catch {
              return {
                ...image,
                review: {
                  status: "failed" as const,
                  summary: "图文交叉检查未完成",
                  detectedLabels: [],
                  issues: ["图像识别服务不可用或图片不可读，请稍后重试。"],
                },
              };
            }
          }),
        );
      }
      if (command.action === "search-patents") {
        const search = await runDisclosurePatentSearch({
          id: command.operationId,
          keywords: command.search!.keywords,
          limit: command.search!.limit,
        });
        state.patentSearches = [search, ...state.patentSearches].slice(0, 5);
        state.messages.push({
          id: command.operationId,
          role: "assistant",
          text: `已按“${search.keywords.join("、")}”检索到 ${search.total} 件相关专利，当前展示前 ${search.items.length} 件。检索结果是外部证据，不会自动写入技术方案。`,
        });
      }
      if (command.action === "analyze-patents") {
        const insight = await analyzeDisclosurePatentEvidence({
          id: command.operationId,
          state,
          searchId: command.searchId!,
          patentIds: command.patentIds!,
        });
        state.patentInsights = [
          insight,
          ...state.patentInsights.filter((item) => item.searchId !== insight.searchId),
        ].slice(0, 10);
        state.messages.push({
          id: command.operationId,
          role: "assistant",
          text: "已生成基于所选检索专利的背景与差异说明建议。请逐项审阅后，手动载入背景章节或自行编辑；技术方案不会被此操作改写。",
        });
      }
      state.issues = checkDisclosure(state);
      if (["edit", "accept", "image", "remove-image", "check-images"].includes(command.action)) {
        state.issues.push({
          section: "technicalSolution",
          severity: "warning",
          message: "文稿或附图已修改，请复核章节一致性和图文关系",
        });
      }
      state.stage = state.issues.length ? "draft" : "ready";
    }
    state = stateSchema.parse(state);
    return await commitDisclosure(resourceId, id, command, state);
  } catch (error) {
    await failDisclosure(resourceId, id, command.operationId);
    throw error;
  }
}
