import type {
  DisclosureCommand,
  DisclosureState,
  SectionKey,
} from "./contracts";
import { mergeSectionImpacts, sectionImpactsFor } from "./dependencies";
import { isUserChapterSection } from "./chapter-policy";

export const writingSteps = [
  "基本信息",
  "技术背景",
  "技术方案",
  "有益效果",
  "生成文档",
] as const;

/** JSONB 返回的对象字段顺序可能变化，草稿比较只关心内容及数组顺序。 */
export function writingDraftKey(draft: unknown): string {
  return JSON.stringify(draft, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
}

/** 流程门槛只检查是否填写；方案简短、图片或检测警告不阻断步骤。 */
export function missingWritingFields(
  state: DisclosureState,
  step: number,
): SectionKey[] {
  const fields: SectionKey[] =
    step >= 1
      ? ["inventionName", "contactPerson", "applicationType", "technicalField"]
      : [];
  if (step >= 2) fields.push("techBackground");
  if (step >= 3) fields.push("technicalSolution");
  if (step >= 4) fields.push("beneficialEffects", "protectionPoints");
  return fields.filter((field) => !state.sections[field].trim());
}

/** 用户保存仅更新填写内容和步骤，不调用任何生成服务。 */
export function saveDisclosureWritingStep(
  state: DisclosureState,
  command: DisclosureCommand,
): DisclosureState {
  const next = structuredClone(state);
  const sections = { ...command.sections };
  if (command.solutionBlocks) {
    next.solutionBlocks = command.solutionBlocks;
    sections.technicalSolution = command.solutionBlocks
      .map((block) => block.content)
      .join("\n");
  }
  for (const [field, text] of Object.entries(sections) as [
    SectionKey,
    string,
  ][]) {
    if (next.sections[field] === text) continue;
    Object.assign(next.sections, { [field]: text });
    if (
      text.trim() &&
      ["techBackground", "beneficialEffects", "protectionPoints"].includes(
        field,
      )
    )
      next.generatedSections = [
        ...new Set([...(next.generatedSections || []), field]),
      ];
    const label = `用户编辑：${field}`;
    const referencedSources = new Set([
      ...next.facts.map((fact) => fact.sourceId),
      ...(next.technicalSolutionQuotes || []).map((quote) => quote.sourceId),
    ]);
    // 历史原稿已有版本快照；自动保存只保留当前编辑原文及仍被引文引用的旧来源。
    next.sources = next.sources.filter(
      (source) => source.label !== label || referencedSources.has(source.id),
    );
    next.sources.push({
      id: `${command.operationId}:${field}`,
      label,
      text,
    });
    if (!next.lockedSections.includes(field)) next.lockedSections.push(field);
    next.suggestions = next.suggestions.filter(
      (patch) =>
        patch.section !== field &&
        !(field === "technicalSolution" && isUserChapterSection(patch.section)),
    );
    next.sectionImpacts = mergeSectionImpacts(
      next.sectionImpacts,
      sectionImpactsFor(field),
    );
    if (field === "technicalSolution" && !command.solutionBlocks)
      next.solutionBlocks = [{ id: "solution", content: text }];
  }
  if (command.keywords) next.keywords = command.keywords;
  if (command.captions)
    next.images = next.images.map((image) => {
      const caption = command.captions?.find(
        (item) => item.id === image.id,
      )?.caption;
      return caption === undefined || caption === image.caption
        ? image
        : { ...image, caption, review: undefined };
    });
  if (command.writingStep !== undefined) {
    if (
      command.writingStep > (state.writingStep ?? 0) &&
      missingWritingFields(next, command.writingStep).length
    )
      throw new Error("请完成当前步骤的必填内容");
    next.writingStep = command.writingStep;
  }
  return next;
}
