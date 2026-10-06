import type { DisclosureState, ModelResult, SectionKey } from "./contracts";
import { resolveTechnicalSolutionQuotes } from "./technical-solution-policy";

export const userChapterSections = [
  "techBackground",
  "beneficialEffects",
  "protectionPoints",
] as const;
export type UserChapterSection = (typeof userChapterSections)[number];
export const isUserChapterSection = (
  section: SectionKey,
): section is UserChapterSection =>
  (userChapterSections as readonly string[]).includes(section);

export function getUserChapter(
  state: DisclosureState,
  section: UserChapterSection,
): string {
  const source = state.sources.findLast(
    (item) =>
      item.label === `用户编辑：${section}` ||
      item.label === `用户材料：${section}`,
  );
  return source?.text.trim() ? state.sections[section] : "";
}

/** 材料中的章节只复制可核验原文；已有用户稿保留，手动清空后不能用旧材料恢复。 */
export function applyExtractedUserChapters(
  state: DisclosureState,
  result: ModelResult,
): DisclosureState {
  const next = structuredClone(state);
  for (const patch of result.patches) {
    if (
      !isUserChapterSection(patch.section) ||
      getUserChapter(next, patch.section) ||
      !patch.sourceQuotes?.length
    )
      continue;
    const previous = next.sources.findLast(
      (item) =>
        item.label === `用户编辑：${patch.section}` ||
        item.label === `用户材料：${patch.section}`,
    );
    if (
      previous &&
      !previous.text.trim() &&
      patch.sourceQuotes.some(
        (quote) =>
          next.sources.findIndex((source) => source.id === quote.sourceId) <=
          next.sources.indexOf(previous),
      )
    )
      continue;
    const original = resolveTechnicalSolutionQuotes(next, patch.sourceQuotes);
    if (!original || original !== patch.content) continue;
    next.sections[patch.section] = original;
    next.sources.push({
      id: `chapter:${patch.section}:${patch.sourceQuotes[0].sourceId}`,
      label: `用户材料：${patch.section}`,
      text: original,
    });
    if (!next.lockedSections.includes(patch.section))
      next.lockedSections.push(patch.section);
  }
  return next;
}
