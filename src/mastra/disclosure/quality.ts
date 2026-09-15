import {
  sectionKeys,
  sectionLabels,
  sectionsSchema,
  type DisclosureState,
  type ModelResult,
  type DisclosureCommand,
} from "./contracts";
import { mergeSectionImpacts, sectionImpactsFor } from "./dependencies";

export function checkDisclosure(
  state: DisclosureState,
): DisclosureState["issues"] {
  const issues: DisclosureState["issues"] = [];
  for (const section of [
    "inventionName",
    "technicalField",
    "techBackground",
    "technicalSolution",
  ] as const) {
    if (!state.sections[section].trim())
      issues.push({
        section,
        severity: "error",
        message: `请补充${sectionLabels[section]}`,
      });
  }
  const evidence = state.sources.map((s) => s.text).join("\n");
  for (const section of sectionKeys) {
    const text = state.sections[section];
    if (/待补充|待确认|待验证/.test(text))
      issues.push({
        section,
        severity: "warning",
        message: "本章节含待补充、待确认或待验证内容",
      });
    for (const value of text.match(/\d+(?:\.\d+)?\s*[%％]/g) || []) {
      if (!evidence.replace(/\s/g, "").includes(value.replace(/\s/g, "")))
        issues.push({
          section,
          severity: "error",
          message: `数值 ${value} 缺少用户材料依据，请删除或补充来源`,
        });
    }
  }
  if (
    state.sections.technicalSolution &&
    state.sections.technicalSolution.length < 200
  )
    issues.push({
      section: "technicalSolution",
      severity: "warning",
      message:
        "技术方案较简短，请核实输入、处理步骤、连接关系及实施条件是否完整",
    });
  for (const [index, image] of state.images.entries()) {
    if (image.detection !== "passed")
      issues.push({
        section: "technicalSolution",
        severity: "warning",
        message: `图${index + 1}：${image.reason || "图片格式检查尚未完成"}`,
      });
    if (!image.caption.trim())
      issues.push({
        section: "technicalSolution",
        severity: "warning",
        message: `图${index + 1}缺少附图说明`,
      });
    if (!image.review || image.review.status === "pending")
      issues.push({
        section: "technicalSolution",
        severity: "warning",
        message: `图${index + 1}尚未完成图文交叉检查`,
      });
    else if (image.review.status !== "passed")
      for (const message of image.review.issues.length
        ? image.review.issues
        : [image.review.summary])
        issues.push({
          section: "technicalSolution",
          severity: "warning",
          message: `图${index + 1}图文核验：${message}`,
        });
  }
  for (const impact of state.sectionImpacts)
    issues.push({
      section: impact.affectedSection,
      severity: "warning",
      message: impact.reason,
    });
  return issues;
}

export function applyModelResult(
  state: DisclosureState,
  result: ModelResult,
  command: DisclosureCommand,
): DisclosureState {
  const next = structuredClone(state);
  // 逐字引文校验，模型推断不能伪装成来源事实。
  next.facts = result.facts.filter((fact) =>
    next.sources.some(
      (source) =>
        source.id === fact.sourceId && source.text.includes(fact.quote),
    ),
  );
  next.questions = result.questions.map((question) =>
    question.replace(/^\s*\d+[.、．)）]\s*/, ""),
  );
  if (command.action !== "check") next.suggestions = [];
  if (command.action !== "check") {
    const directImpacts: DisclosureState["sectionImpacts"] = [];
    const suggestedImpacts: DisclosureState["sectionImpacts"] = [];
    const reviewedSections = new Set<DisclosureState["sectionImpacts"][number]["affectedSection"]>();
    for (const patch of result.patches) {
      const valid = sectionsSchema.safeParse({
        ...next.sections,
        [patch.section]: patch.content,
      });
      if (!valid.success) {
        result.issues.push({
          section: patch.section,
          severity: "warning",
          message: `本次生成的${sectionLabels[patch.section]}格式不正确，已保留原内容，请手动补充`,
        });
        continue;
      }
      const sourceText = next.sources
        .map((source) => source.text)
        .join("\n")
        .replace(/\s/g, "");
      const unsupported = (
        patch.content.match(/\d+(?:\.\d+)?\s*[%％]/g) || []
      ).filter((value) => !sourceText.includes(value.replace(/\s/g, "")));
      if (unsupported.length) {
        // 不把无来源的提升比例写入初稿或建议。
        result.issues.push({
          section: patch.section,
          severity: "error",
          message: `本次生成包含无依据数值 ${unsupported.join("、")}，已拦截该章节修改，请补充依据或重试`,
        });
        continue;
      }
      if (command.action === "revise" && patch.section !== command.section) {
        next.suggestions.push(patch);
        suggestedImpacts.push(...sectionImpactsFor(patch.section, "suggested"));
      } else if (next.lockedSections.includes(patch.section)) {
        next.suggestions.push(patch);
        suggestedImpacts.push(...sectionImpactsFor(patch.section, "suggested"));
      } else {
        // 所有内容仍须通过 sectionsSchema 校验后才能保存。
        if (
          next.sections[patch.section].trim() &&
          next.sections[patch.section] !== patch.content
        ) {
          directImpacts.push(...sectionImpactsFor(patch.section));
          reviewedSections.add(patch.section);
        }
        Object.assign(next.sections, { [patch.section]: patch.content });
      }
    }
    next.sectionImpacts = mergeSectionImpacts(
      next.sectionImpacts.filter(
        (impact) => !reviewedSections.has(impact.affectedSection),
      ),
      [...directImpacts, ...suggestedImpacts],
    );
  }
  const checks = checkDisclosure(next);
  next.issues = [...checks, ...result.issues]
    .filter(
      (issue, index, all) =>
        all.findIndex(
          (item) =>
            item.section === issue.section && item.message === issue.message,
        ) === index,
    )
    .slice(0, 100);
  next.stage = !next.sections.technicalSolution
    ? next.questions.length
      ? "awaiting_input"
      : "collecting"
    : next.questions.length
      ? "awaiting_input"
      : next.issues.length
        ? "draft"
        : "ready";
  next.messages.push({
    role: "assistant",
    id: command.operationId,
    text:
      !next.sections.technicalSolution &&
      !next.suggestions.some((patch) => patch.section === "technicalSolution")
        ? "已整理当前材料，尚未形成技术方案正文。请补充下列关键问题，或点击“生成初稿”先形成带待补充标记的文稿。"
        : result.reply,
  });
  return next;
}
