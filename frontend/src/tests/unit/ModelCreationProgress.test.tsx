import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ModelCreationProgress, type ModelCreationStepMeta } from '../../features/model-creation/components/ModelCreationProgress';
import type { DraftValidation } from '../../features/model-creation/utils/validateModelDraft';

const steps: ModelCreationStepMeta[] = [
  { title: '基础信息', description: '基础配置', sectionKeys: ['basic_info'] },
  { title: '模型语义', description: '语义配置', sectionKeys: ['component_dependencies'] },
  { title: '数学展开', description: '公式配置', sectionKeys: ['formula'] },
  { title: '运行参数', description: '参数配置', sectionKeys: ['runtime_parameters'] },
  { title: '校验发布', description: '发布检查', sectionKeys: ['solver_compatibility'] },
];

const validation: DraftValidation = {
  valid: false,
  sections: {
    basic_info: { valid: true, errors: [] },
    component_dependencies: { valid: false, errors: ['组件缺少依赖'] },
    formula: { valid: true, errors: [] },
    runtime_parameters: { valid: true, errors: [] },
    solver_compatibility: { valid: true, errors: [] },
  },
};

test('renders horizontal five-step progress with validation states', () => {
  render(<ModelCreationProgress currentStep={0} steps={steps} validation={validation} onChange={vi.fn()} />);

  expect(screen.getByLabelText('模型创建流程')).toBeInTheDocument();
  expect(screen.getByText('五步建模流程')).toBeInTheDocument();
  expect(screen.getByText('校验发布')).toBeInTheDocument();
  expect(screen.getAllByText('待进行').length).toBeGreaterThan(0);
  expect(screen.queryByText('待修复')).not.toBeInTheDocument();
  expect(screen.queryByText(/阻断项：第 2 步/)).not.toBeInTheDocument();
});

test('blocks entering a later step when previous step has errors', () => {
  const onChange = vi.fn();
  render(<ModelCreationProgress currentStep={1} steps={steps} validation={validation} onChange={onChange} />);

  fireEvent.click(screen.getByText('3 数学展开'));

  expect(onChange).not.toHaveBeenCalled();
});

test('shows completed state only for previous valid steps', () => {
  render(<ModelCreationProgress currentStep={1} steps={steps} validation={validation} onChange={vi.fn()} />);

  expect(screen.getByText('已完成')).toBeInTheDocument();
  expect(screen.getByText('待修复')).toBeInTheDocument();
});
