import { optimizeDisclosureSection } from "../section-optimization/service";

type BackgroundInput = {
  inventionName: string;
  technicalField: string;
  existingProblems: string;
  userDraft: string;
  technicalSolution: string;
  instruction?: string;
};

export async function generateBackground(
  params: BackgroundInput,
): Promise<string> {
  return optimizeDisclosureSection({
    section: "techBackground",
    userDraft: params.userDraft,
    technicalSolution: params.technicalSolution,
    context: JSON.stringify({
      inventionName: params.inventionName,
      technicalField: params.technicalField,
      existingProblems: params.existingProblems,
    }),
    instruction: params.instruction,
  });
}

export async function* streamBackground(params: BackgroundInput) {
  yield await generateBackground(params);
}
