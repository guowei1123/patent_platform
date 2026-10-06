import { generateBackground } from "@/app/api/disclosure/background-generation/service";
import { generateBeneficialEffects } from "@/app/api/disclosure/beneficial-effect-generation/service";
import { detectDisclosureProblems } from "@/app/api/disclosure/problem-detection/service";
import { optimizeProposalText } from "@/app/api/disclosure/proposal-text-optimization/service";
import { generateProtectionPoints } from "@/app/api/disclosure/pre-protection-point-generation/service";
import { organizeDisclosureMaterials } from "@/app/api/disclosure/material-organization/service";
import { generateKeywordsExplanation } from "@/app/api/disclosure/explanation-of-keywords/service";
import { detectImageProperties } from "@/app/api/disclosure/image-detection/service";
import { crossCheckDisclosureImage } from "./image-cross-check";
import { imageSize } from "./images";
import { z } from "zod";
import { keywordDefinitionsSchema } from "./contracts";
import type {
  DisclosureCommand,
  DisclosureState,
  ModelResult,
  SectionKey,
} from "./contracts";
import {
  getUserTechnicalSolution,
  inspectTechnicalSolution,
  applyExtractedUserSolution,
} from "./technical-solution-policy";
import { getUserChapter, applyExtractedUserChapters } from "./chapter-policy";
import { sectionLabels } from "./contracts";

function contentFor(
  state: DisclosureState,
  result: ModelResult,
  section: SectionKey,
) {
  return (
    result.patches.find((patch) => patch.section === section)?.content ||
    state.sections[section]
  );
}

function replacePatch(
  result: ModelResult,
  section: SectionKey,
  content: string,
  reason: string,
) {
  const text = content.trim();
  if (!text) return;
  const index = result.patches.findIndex((patch) => patch.section === section);
  const patch = { section, content: text, reason };
  if (index >= 0) result.patches[index] = patch;
  else result.patches.push(patch);
}

function addFailure(result: ModelResult, section: SectionKey, name: string) {
  result.issues.push({
    section,
    severity: "warning",
    message: `${name}暂未完成，已保留当前文稿，可稍后重新生成或检查。`,
  });
}

function addProblemIssues(result: ModelResult, text: string) {
  const messages = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[\d一二三四五六七八九十]+[.、．)]|[-•])\s*/, "")
        .trim(),
    )
    .filter((line) => line.length >= 6)
    .slice(0, 12);
  for (const message of messages)
    result.issues.push({
      section: "technicalSolution",
      severity: "warning",
      message: `方案问题检测：${message}`,
    });
}

export type DisclosureFeature =
  | "materials"
  | "background"
  | "benefits"
  | "protection"
  | "polish"
  | "problems"
  | "images"
  | "terms";
export type DisclosureFeatureInput = {
  state: DisclosureState;
  command: DisclosureCommand;
  result: ModelResult;
  imageAssets?: Array<{
    id: string;
    mime: "image/png" | "image/jpeg";
    base64: string;
  }>;
};

/** 每个工具只执行一个功能，正文均来自对应服务。 */
export async function runDisclosureFeature(
  feature: DisclosureFeature,
  input: DisclosureFeatureInput,
): Promise<ModelResult> {
  const next = structuredClone(input.result);
  const state = applyExtractedUserChapters(
    applyExtractedUserSolution(input.state, input.result),
    input.result,
  );
  const solution = getUserTechnicalSolution(state);
  if (feature === "images") {
    next.imageChecks = [];
    for (const image of state.images) {
      const asset = input.imageAssets?.find((item) => item.id === image.id);
      let detection: "passed" | "warning" | "failed" = "failed";
      let reason = "图片原文件缺失，请重新上传。";
      let review = image.review;
      if (asset) {
        const imageUrl = `data:${asset.mime};base64,${asset.base64}`;
        try {
          imageSize(Buffer.from(asset.base64, "base64"));
          const result = z
            .object({
              isWhiteBackground: z.boolean(),
              isBlackLines: z.boolean(),
              reason: z.string(),
            })
            .parse(await detectImageProperties({ imageUrl }));
          detection =
            result.isWhiteBackground && result.isBlackLines
              ? "passed"
              : "warning";
          reason = result.reason.slice(0, 2000);
        } catch {
          reason = "图片格式检测未完成，请重试。";
        }
        try {
          review = await crossCheckDisclosureImage({
            imageUrl,
            caption: image.caption,
            technicalSolution: state.sections.technicalSolution,
          });
        } catch {
          review = {
            status: "failed",
            summary: "图文核验未完成，请重试。",
            detectedLabels: [],
            issues: ["图像服务暂不可用。"],
          };
        }
      } else
        review = {
          status: "failed",
          summary: reason,
          detectedLabels: [],
          issues: [reason],
        };
      next.imageChecks.push({ id: image.id, detection, reason, review });
    }
    return next;
  }
  if (feature === "terms") {
    if (!solution.trim()) return next;
    try {
      const output = z
        .object({
          keywords: z
            .array(z.object({ term: z.string(), explanation: z.string() }))
            .max(30),
        })
        .parse(
          await generateKeywordsExplanation({
            techSolution: state.sections.technicalSolution || solution,
          }),
        );
      next.keywords = keywordDefinitionsSchema.parse(
        output.keywords
          .filter((item) => solution.includes(item.term))
          .map((item) => ({ term: item.term, definition: item.explanation })),
      );
    } catch {
      addFailure(next, "technicalSolution", "关键术语释义工具");
    }
    return next;
  }
  if (feature === "materials") {
    try {
      const organized = await organizeDisclosureMaterials({
        state: input.state,
        instruction: input.command.message,
      });
      next.facts = organized.facts.filter((fact) =>
        input.state.sources.some(
          (source) =>
            source.id === fact.sourceId && source.text.includes(fact.quote),
        ),
      );
      next.questions = organized.questions;
      next.reply = organized.reply;
      next.technicalSolutionQuotes = organized.technicalSolutionQuotes;
      next.patches.push(
        ...organized.patches.filter(
          (patch) =>
            [
              "inventionName",
              "contactPerson",
              "applicationType",
              "technicalField",
              "techBackground",
              "beneficialEffects",
              "protectionPoints",
            ].includes(patch.section) &&
            (input.command.action !== "revise" ||
              patch.section === input.command.section),
        ),
      );
    } catch {
      addFailure(next, "technicalField", "材料整理工具");
      next.reply = "材料整理暂未完成，已保留原有材料，请稍后重试。";
    }
    return next;
  }
  const assessment = inspectTechnicalSolution(solution);
  if (
    !assessment.ready &&
    !(
      solution.trim() &&
      ["optimize-solution", "check"].includes(input.command.action)
    )
  ) {
    next.reply = assessment.message;
    next.issues.push({
      section: "technicalSolution",
      severity: "error",
      message: assessment.message,
    });
    return next;
  }
  const background = state.sections.techBackground;
  if (["background", "benefits", "protection"].includes(feature)) {
    const section =
      feature === "background"
        ? "techBackground"
        : feature === "benefits"
          ? "beneficialEffects"
          : "protectionPoints";
    const userDraft = getUserChapter(state, section);
    // 刚从材料提取的原稿先保存，不能在同一链中替换其逐字来源为生成稿。
    if (userDraft.trim() && !getUserChapter(input.state, section).trim())
      return next;
    if (!userDraft.trim()) {
      next.issues.push({
        section,
        severity: "warning",
        message: `请先填写${sectionLabels[section]}，再进行AI优化。`,
      });
      next.reply = `请先填写${sectionLabels[section]}，当前原稿已保留。`;
      return next;
    }
    const inventionName = contentFor(input.state, next, "inventionName");
    const technicalField = contentFor(input.state, next, "technicalField");
    if (feature === "background" && (!inventionName || !technicalField)) {
      next.issues.push({
        section: "technicalField",
        severity: "warning",
        message: "请补充发明名称和技术领域后再优化背景。",
      });
      return next;
    }
    try {
      const instruction =
        input.command.action === "revise"
          ? input.command.message
          : "优化用户原稿，并补充核心方案直接支撑的相关遗漏";
      const content =
        feature === "background"
          ? await generateBackground({
              inventionName,
              technicalField,
              existingProblems: userDraft,
              userDraft,
              technicalSolution: solution,
              instruction,
            })
          : await (
              feature === "benefits"
                ? generateBeneficialEffects
                : generateProtectionPoints
            )({
              technicalBackground: background,
              technicalSolution: solution,
              userDraft,
              instruction,
            });
      replacePatch(
        next,
        section,
        content,
        "依据用户原稿及核心方案优化，补充内容须由用户确认",
      );
      next.reply =
        "已提供章节优化建议，请核对后采用；原稿和核心技术方案未自动修改。";
    } catch (error) {
      next.issues.push({
        section,
        severity: "warning",
        message: (error as Error).message || "章节优化未完成，已保留用户原稿。",
      });
      next.reply = "章节优化未完成，已保留用户原稿，请核对核心方案后重试。";
    }
  } else if (feature === "polish") {
    try {
      const blocks = state.solutionBlocks;
      const block = input.command.blockId
        ? blocks?.find((item) => item.id === input.command.blockId)
        : undefined;
      if (input.command.blockId && !block)
        throw new Error("方案分栏已变化，请重试");
      const currentBlocks = blocks?.length
        ? blocks
        : [
            {
              id: "solution",
              content: state.sections.technicalSolution || solution,
            },
          ];
      const optimizedBlocks = [];
      for (const item of currentBlocks) {
        if ((block && item.id !== block.id) || !item.content.trim()) {
          optimizedBlocks.push(item);
          continue;
        }
        try {
          const content = await optimizeProposalText({
            text: item.content,
            optimizationType: "standard",
          });
          optimizedBlocks.push({ ...item, content });
        } catch {
          optimizedBlocks.push(item);
          addFailure(
            next,
            "technicalSolution",
            `描述 ${currentBlocks.indexOf(item) + 1} 的语言优化`,
          );
        }
      }
      if (
        !optimizedBlocks.some(
          (item, index) => item.content !== currentBlocks[index].content,
        )
      ) {
        next.reply = next.issues.length
          ? "本次语言优化未完成，原文已保留。"
          : "当前表述无需调整。";
        return next;
      }
      replacePatch(
        next,
        "technicalSolution",
        optimizedBlocks.map((item) => item.content).join("\n"),
        "语言和格式优化工具返回",
      );
      next.patches.find(
        (patch) => patch.section === "technicalSolution",
      )!.solutionBlocks = optimizedBlocks;
      next.reply = "仅整理用户原文的语言和格式，请审阅建议，原文未自动覆盖。";
    } catch {
      addFailure(next, "technicalSolution", "语言和格式优化工具");
      next.reply =
        "本次语言和格式优化暂未通过，用户原文已保留，没有自动补写或修改核心方案。";
    }
  } else if (feature === "problems") {
    try {
      addProblemIssues(
        next,
        await detectDisclosureProblems({ technicalSolution: solution }),
      );
      if (input.command.action === "check")
        next.reply = "本轮检查已完成，请复核检查结果；用户技术方案未修改。";
    } catch {
      addFailure(next, "technicalSolution", "问题检测工具");
    }
  }
  next.issues = next.issues.slice(0, 40);
  return next;
}

/** 兼容已有调用方；工作流通过单功能工具逐项调用 runDisclosureFeature。 */
export async function enrichDisclosureWithServices(input: {
  state: DisclosureState;
  command: DisclosureCommand;
  result: ModelResult;
  drafting: boolean;
}) {
  let result = structuredClone(input.result);
  result.patches = result.patches.filter(
    (patch) => patch.section !== "technicalSolution",
  );
  const features: DisclosureFeature[] = input.drafting
    ? ["background", "benefits", "protection", "problems"]
    : input.command.action === "revise" &&
        input.command.section === "technicalSolution"
      ? ["polish", "problems"]
      : input.command.action === "check"
        ? ["problems"]
        : [];
  for (const feature of features)
    result = await runDisclosureFeature(feature, {
      state: input.state,
      command: input.command,
      result,
    });
  return result;
}
