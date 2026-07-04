import type { DraftValidation } from './validateModelDraft';

export interface ModelCreationStepMeta {
  title: string;
  description: string;
  sectionKeys: string[];
}

export interface StepBlocker {
  stepIndex: number;
  stepTitle: string;
  sectionKey: string;
  error: string;
}

export function firstStepError(validation: DraftValidation, step: ModelCreationStepMeta, stepIndex: number): StepBlocker | null {
  for (const sectionKey of step.sectionKeys) {
    const section = validation.sections[sectionKey];
    const error = section?.errors?.[0];
    if (error) {
      return { stepIndex, stepTitle: step.title, sectionKey, error };
    }
  }
  return null;
}

export function canEnterStep({
  targetStep,
  currentStep,
  steps,
  validation,
}: {
  targetStep: number;
  currentStep: number;
  steps: ModelCreationStepMeta[];
  validation: DraftValidation;
}) {
  if (targetStep <= currentStep) return { allowed: true as const };
  for (let index = 0; index < targetStep; index += 1) {
    const blocker = firstStepError(validation, steps[index], index);
    if (blocker) return { allowed: false as const, blocker };
  }
  return { allowed: true as const };
}

export function blockerMessage(blocker: StepBlocker) {
  return `请先处理第 ${blocker.stepIndex + 1} 步「${blocker.stepTitle}」：${blocker.error}`;
}
