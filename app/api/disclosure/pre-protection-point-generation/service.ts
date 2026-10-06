import { optimizeDisclosureSection } from "../section-optimization/service";

type ProtectionInput = {
  technicalBackground: string;
  technicalSolution: string;
  userDraft: string;
  instruction?: string;
};

export async function generateProtectionPoints(
  params: ProtectionInput,
): Promise<string> {
  return optimizeDisclosureSection({
    section: "protectionPoints",
    userDraft: params.userDraft,
    technicalSolution: params.technicalSolution,
    context: params.technicalBackground,
    instruction: params.instruction,
  });
}

export async function* streamProtectionPoints(params: ProtectionInput) {
  yield await generateProtectionPoints(params);
}
