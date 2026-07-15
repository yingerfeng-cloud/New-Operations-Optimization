import { Space, Tag, message } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { ProgressStepper } from '../../../components/LayoutPrimitives';
import type { DraftValidation } from '../utils/validateModelDraft';
import { blockerMessage, canEnterStep, firstStepError, type ModelCreationStepMeta } from '../utils/workflowGuard';

export type { ModelCreationStepMeta } from '../utils/workflowGuard';

function stepVisualState(validation: DraftValidation, steps: ModelCreationStepMeta[], index: number, current: number, visitedThrough: number) {
  const blocker = firstStepError(validation, steps[index], index);
  if (index > visitedThrough) return { text: '待进行', color: 'default', icon: <ClockCircleOutlined />, status: 'wait' as const };
  if (blocker) return { text: '待修复', color: 'red', icon: <ExclamationCircleOutlined />, status: 'error' as const };
  if (index === current) return { text: '进行中', color: 'blue', icon: <SyncOutlined spin />, status: 'process' as const };
  return { text: '已完成', color: 'green', icon: <CheckCircleOutlined />, status: 'finish' as const };
}

export function ModelCreationProgress({
  currentStep,
  steps,
  validation,
  visitedThrough = currentStep,
  onChange,
}: {
  currentStep: number;
  steps: ModelCreationStepMeta[];
  validation: DraftValidation;
  visitedThrough?: number;
  onChange: (step: number) => void;
}) {
  return (
    <section className="model-progress-card" aria-label="模型创建流程">
      <div className="model-progress-head">
        <div>
          <strong>五步建模流程</strong>
          <span>从业务语义到数学展开、运行参数和发布校验的完整工作流</span>
        </div>
      </div>
      <ProgressStepper
        current={currentStep}
        onChange={target => {
          const guard = canEnterStep({ targetStep: target, currentStep, steps, validation });
          if (!guard.allowed) {
            message.warning(blockerMessage(guard.blocker));
            return;
          }
          onChange(target);
        }}
        items={steps.map((item, index) => {
          const state = stepVisualState(validation, steps, index, currentStep, visitedThrough);
          return {
            title: (
              <Space size={6}>
                {state.icon}
                <span>{index + 1} {item.title}</span>
                <span className="sr-only">{item.title}</span>
              </Space>
            ),
            description: <Tag color={state.color}>{state.text}</Tag>,
            status: state.status,
          };
        })}
      />
    </section>
  );
}
