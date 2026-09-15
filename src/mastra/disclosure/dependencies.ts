import {
  sectionLabels,
  type DisclosureState,
  type SectionKey,
} from "./contracts";

/** 修改一个章节后需要人工复核的关联章节。这里只记录影响，不自动覆盖正文。 */
const dependencies: Record<SectionKey, SectionKey[]> = {
  inventionName: [],
  contactPerson: [],
  applicationType: [],
  technicalField: ["techBackground", "technicalSolution"],
  techBackground: ["technicalSolution", "beneficialEffects", "protectionPoints"],
  technicalSolution: ["beneficialEffects", "protectionPoints"],
  beneficialEffects: ["protectionPoints"],
  protectionPoints: ["technicalSolution"],
};

export function sectionImpactsFor(
  section: SectionKey,
  status: "needs-review" | "suggested" = "needs-review",
): DisclosureState["sectionImpacts"] {
  return dependencies[section].map((affectedSection) => ({
    sourceSection: section,
    affectedSection,
    status,
    reason: `“${sectionLabels[section]}”已更新，请复核“${sectionLabels[affectedSection]}”中的对应描述。`,
  }));
}

export function mergeSectionImpacts(
  existing: DisclosureState["sectionImpacts"],
  additions: DisclosureState["sectionImpacts"],
) {
  return [...existing, ...additions]
    .filter(
      (item, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.sourceSection === item.sourceSection &&
            candidate.affectedSection === item.affectedSection,
        ) === index,
    )
    .slice(-40);
}
