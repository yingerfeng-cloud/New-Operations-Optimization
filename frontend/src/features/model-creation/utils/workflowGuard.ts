import type { DraftValidation } from './validateModelDraft';
import type { ModelValidationIssueLocation } from '../navigation/modelNavigationCommand';

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

export interface ModelValidationIssue {
  code: string;
  severity: 'error';
  stepIndex: number;
  stepTitle: string;
  sectionKey: string;
  sectionLabel: string;
  fieldCode?: string;
  objectId?: string;
  location: ModelValidationIssueLocation;
  precision: 'exact' | 'section';
  message: string;
  fixHint?: string;
}

const sectionLabels: Record<string, string> = {
  basic_info: '基础信息', semantic_structure: '模型语义', time_dimension: '时间维度', component_dependencies: '组件依赖',
  parameter_bindings: '参数绑定', formula: '数学公式', runtime_parameters: '运行参数', problem_type: '问题类型', solver_compatibility: '求解器兼容性',
};

function issueLocation(sectionKey: string, stepIndex: number, message: string): ModelValidationIssueLocation {
  const fieldCode = message.match(/(?:参数|运行参数|变量|集合|组件)\s+([^\s：:，,]+)/)?.[1];
  const category = message.includes('集合') ? 'sets' : message.includes('变量') ? 'variables' : message.includes('参数') ? 'parameters' : undefined;
  const sectionMap: Record<string, Omit<ModelValidationIssueLocation, 'stepIndex'>> = {
    basic_info: { sectionKey: message.includes('场景') ? 'scenario' : 'model', fieldCode: message.includes('编码') ? 'model_code' : undefined, collapseKeys: message.includes('编码') ? ['advanced-code'] : undefined },
    semantic_structure: { sectionKey: category || 'overview', tabKey: category, collapseKeys: category ? ['advanced-detail'] : undefined, fieldCode, objectId: fieldCode },
    time_dimension: { sectionKey: 'time' },
    component_dependencies: { sectionKey: 'dependencies', fieldCode, objectId: fieldCode },
    parameter_bindings: { sectionKey: 'bindings', fieldCode, objectId: fieldCode },
    formula: { sectionKey: message.includes('约束') ? 'constraints' : 'compile', collapseKeys: ['advanced-debug'], fieldCode, objectId: fieldCode },
    runtime_parameters: { sectionKey: message.includes('时间序列') ? 'series' : 'basic', fieldCode, objectId: fieldCode },
    problem_type: { sectionKey: 'debug', collapseKeys: ['advanced-debug'] },
    solver_compatibility: { sectionKey: 'compatibility' },
  };
  return { stepIndex, ...(sectionMap[sectionKey] || { sectionKey }) };
}

export function modelValidationIssues(validation: DraftValidation, steps: ModelCreationStepMeta[]): ModelValidationIssue[] {
  return Object.entries(validation.sections).flatMap(([sectionKey, section]) => {
    const stepIndex = Math.max(0, steps.findIndex(step => step.sectionKeys.includes(sectionKey)));
    const step = steps[stepIndex];
    return (section.errors || []).map(message => {
      const location = issueLocation(sectionKey, stepIndex, message);
      return {
        code: `${sectionKey}.${indexOfMessage(section.errors || [], message)}`,
        severity: 'error' as const,
        stepIndex, stepTitle: step?.title || '基础信息', sectionKey, sectionLabel: sectionLabels[sectionKey] || sectionKey,
        fieldCode: location.fieldCode, objectId: location.objectId, location, message,
        precision: location.fieldCode || location.objectId ? 'exact' as const : 'section' as const,
        fixHint: sectionKey === 'runtime_parameters' ? '补充必填值或默认值，并确认来源分类。' : sectionKey === 'formula' ? '打开对应公式或编译预览，修正后重新编译。' : '前往对应章节检查必填项、引用关系与模型契约。',
      };
    });
  });
}

function indexOfMessage(messages: string[], message: string) {
  return Math.max(0, messages.indexOf(message));
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
