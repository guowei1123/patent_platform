import {
  generateBackground,
} from "@/app/api/disclosure/background-generation/service";
import {
  generateBeneficialEffects,
} from "@/app/api/disclosure/beneficial-effect-generation/service";
import {
  detectDisclosureProblems,
} from "@/app/api/disclosure/problem-detection/service";
import {
  optimizeProposalText,
} from "@/app/api/disclosure/proposal-text-optimization/service";
import {
  generateProtectionPoints,
} from "@/app/api/disclosure/pre-protection-point-generation/service";
import type {
  DisclosureCommand,
  DisclosureState,
  ModelResult,
  SectionKey,
} from "./contracts";

function contentFor(
  state: DisclosureState,
  result: ModelResult,
  section: SectionKey,
) {
  return result.patches.find((patch) => patch.section === section)?.content ||
    state.sections[section];
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

function addFailure(
  result: ModelResult,
  section: SectionKey,
  name: string,
) {
  result.issues.push({
    section,
    severity: "warning",
    message: `${name}暂未完成，已保留当前文稿，可稍后重新生成或检查。`,
  });
}

function addProblemIssues(result: ModelResult, text: string) {
  const messages = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[\d一二三四五六七八九十]+[.、．)]|[-•])\s*/, "").trim())
    .filter((line) => line.length >= 6)
    .slice(0, 12);
  for (const message of messages)
    result.issues.push({
      section: "technicalSolution",
      severity: "warning",
      message: `方案问题检测：${message}`,
    });
}

/**
 * 将已有 disclosure 服务统一适配为工作流可消费的章节补丁与问题项。
 * 服务失败时不覆盖主智能体草稿，保证任务仍可恢复和重试。
 */
export async function enrichDisclosureWithServices(input: {
  state: DisclosureState;
  command: DisclosureCommand;
  result: ModelResult;
  drafting: boolean;
}) {
  const next = structuredClone(input.result);
  const isTechnicalSolutionRevision =
    input.command.action === "revise" &&
    input.command.section === "technicalSolution";

  if (input.drafting) {
    const inventionName = contentFor(input.state, next, "inventionName");
    const technicalField = contentFor(input.state, next, "technicalField");
    const agentBackground = contentFor(input.state, next, "techBackground");
    let technicalBackground = agentBackground;
    try {
      technicalBackground = await generateBackground({
        inventionName,
        technicalField,
        existingProblems: agentBackground,
      });
      replacePatch(next, "techBackground", technicalBackground, "由背景技术生成服务整理");
    } catch {
      addFailure(next, "techBackground", "背景技术生成服务");
    }

    const originalSolution = contentFor(input.state, next, "technicalSolution");
    const [optimized, beneficialEffects, protectionPoints, problems] =
      await Promise.allSettled([
        optimizeProposalText({ text: originalSolution, optimizationType: "standard" }),
        generateBeneficialEffects({
          technicalBackground,
          technicalSolution: originalSolution,
        }),
        generateProtectionPoints({
          technicalBackground,
          technicalSolution: originalSolution,
        }),
        detectDisclosureProblems({ technicalSolution: originalSolution }),
      ]);

    if (optimized.status === "fulfilled")
      replacePatch(next, "technicalSolution", optimized.value, "由技术方案优化服务整理");
    else addFailure(next, "technicalSolution", "技术方案优化服务");
    if (beneficialEffects.status === "fulfilled")
      replacePatch(next, "beneficialEffects", beneficialEffects.value, "由有益效果生成服务整理");
    else addFailure(next, "beneficialEffects", "有益效果生成服务");
    if (protectionPoints.status === "fulfilled")
      replacePatch(next, "protectionPoints", protectionPoints.value, "由保护点生成服务整理");
    else addFailure(next, "protectionPoints", "保护点生成服务");
    if (problems.status === "fulfilled") addProblemIssues(next, problems.value);
    else addFailure(next, "technicalSolution", "方案问题检测服务");
  } else if (isTechnicalSolutionRevision) {
    const proposed = contentFor(input.state, next, "technicalSolution");
    const [optimized, problems] = await Promise.allSettled([
      optimizeProposalText({ text: proposed, optimizationType: "standard" }),
      detectDisclosureProblems({ technicalSolution: proposed }),
    ]);
    if (optimized.status === "fulfilled")
      replacePatch(next, "technicalSolution", optimized.value, "由技术方案优化服务整理");
    else addFailure(next, "technicalSolution", "技术方案优化服务");
    if (problems.status === "fulfilled") addProblemIssues(next, problems.value);
    else addFailure(next, "technicalSolution", "方案问题检测服务");
  } else if (input.command.action === "check") {
    const solution = input.state.sections.technicalSolution;
    if (solution.trim()) {
      try {
        addProblemIssues(
          next,
          await detectDisclosureProblems({ technicalSolution: solution }),
        );
      } catch {
        addFailure(next, "technicalSolution", "方案问题检测服务");
      }
    }
  }
  next.issues = next.issues.slice(0, 40);
  return next;
}
