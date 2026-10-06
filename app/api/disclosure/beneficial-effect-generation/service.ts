import { optimizeDisclosureSection } from "../section-optimization/service";

type BenefitsInput = {
  technicalBackground: string;
  technicalSolution: string;
  userDraft: string;
  instruction?: string;
};

export async function generateBeneficialEffects(
  params: BenefitsInput,
): Promise<string> {
  return optimizeDisclosureSection({
    section: "beneficialEffects",
    userDraft: params.userDraft,
    technicalSolution: params.technicalSolution,
    context: params.technicalBackground,
    instruction: params.instruction,
  });
}

export async function* streamBeneficialEffects(params: BenefitsInput) {
  yield await generateBeneficialEffects(params);
}
