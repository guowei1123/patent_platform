import { mastra } from "../index";
import { stateSchema, type DisclosureCommand } from "./contracts";
import { mergeSectionImpacts, sectionImpactsFor } from "./dependencies";
import { saveDisclosureWritingStep } from "./writing-flow";
import { isUserChapterSection } from "./chapter-policy";
import {
  analyzeDisclosurePatentEvidence,
  runDisclosurePatentSearch,
} from "./patent-search";
import { checkDisclosure } from "./quality";
import {
  getUserTechnicalSolution,
  inspectTechnicalSolution,
  isTechnicalSolutionPolish,
} from "./technical-solution-policy";
import {
  claimDisclosure,
  commitDisclosure,
  failDisclosure,
  getDisclosureTask,
  getDisclosureVersion,
  getDisclosureAsset,
  renewDisclosureLease,
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
  let renewing = false;
  const leaseTimer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void renewDisclosureLease(resourceId, id, command.operationId)
      .catch(() => {})
      .finally(() => {
        renewing = false;
      });
  }, 30000);
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
    if (
      [
        "message",
        "draft",
        "revise",
        "check",
        "generate-background",
        "generate-benefits",
        "optimize-solution",
        "explain-terms",
        "check-images",
      ].includes(command.action)
    ) {
      stateSchema.parse(state);
      const imageAssets = [
        "check",
        "check-images",
        "optimize-solution",
      ].includes(command.action)
        ? (
            await Promise.all(
              state.images.map(async (image) => {
                const asset = await getDisclosureAsset(
                  resourceId,
                  id,
                  image.id,
                );
                if (!asset || !["image/png", "image/jpeg"].includes(asset.mime))
                  return null;
                return {
                  id: image.id,
                  mime: asset.mime as "image/png" | "image/jpeg",
                  base64: asset.data.toString("base64"),
                };
              }),
            )
          ).filter((item) => item !== null)
        : undefined;
      const run = await mastra.getWorkflow("disclosureWorkflow").createRun();
      const result = await run.start({
        inputData: { state, command, imageAssets },
      });
      if (result.status !== "success") throw new Error("交底书生成步骤失败");
      state = stateSchema.parse(result.result);
    } else {
      if (command.action === "save-step")
        state = saveDisclosureWritingStep(state, command);
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
        if (section === "technicalSolution" && command.action === "accept") {
          const original = getUserTechnicalSolution(state);
          if (
            !inspectTechnicalSolution(original).ready ||
            !isTechnicalSolutionPolish(original, content) ||
            (state.suggestions.find((patch) => patch.section === section)
              ?.solutionBlocks &&
              state.suggestions
                .find((patch) => patch.section === section)!
                .solutionBlocks!.map((block) => block.content)
                .join("\n") !== content)
          )
            throw new DisclosureRequestError(
              "该建议包含技术内容变化或缺少用户原文，不能采用。请自行填写技术方案后再进行语言和格式优化。",
              400,
            );
        }
        Object.assign(state.sections, { [section]: content });
        if (section === "technicalSolution") {
          const suggestion = state.suggestions.find(
            (patch) => patch.section === section,
          );
          state.solutionBlocks =
            command.action === "accept" && suggestion?.solutionBlocks
              ? suggestion.solutionBlocks
              : [{ id: "solution", content }];
        }
        if (!state.lockedSections.includes(section))
          state.lockedSections.push(section);
        state.suggestions = state.suggestions.filter(
          (p) =>
            p.section !== section &&
            !(
              section === "technicalSolution" && isUserChapterSection(p.section)
            ),
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
          ...state.patentInsights.filter(
            (item) => item.searchId !== insight.searchId,
          ),
        ].slice(0, 10);
        state.messages.push({
          id: command.operationId,
          role: "assistant",
          text: "已生成基于所选检索专利的背景与差异说明建议。请逐项审阅后，手动载入背景章节或自行编辑；技术方案不会被此操作改写。",
        });
      }
      state.suggestions = state.suggestions.filter(
        (patch) =>
          patch.section !== "technicalSolution" ||
          (inspectTechnicalSolution(getUserTechnicalSolution(state)).ready &&
            isTechnicalSolutionPolish(
              getUserTechnicalSolution(state),
              patch.content,
            )),
      );
      state.issues = checkDisclosure(state);
      if (
        ["edit", "accept", "image", "remove-image", "check-images"].includes(
          command.action,
        )
      ) {
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
  } finally {
    clearInterval(leaseTimer);
  }
}
