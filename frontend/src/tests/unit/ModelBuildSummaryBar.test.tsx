import { render, screen } from '@testing-library/react';
import { ModelBuildSummaryBar } from '../../features/model-creation/components/ModelBuildSummaryBar';
import { createInitialDraft } from '../../features/model-creation/stores/modelCreationStore';
import { validateModelDraft } from '../../features/model-creation/utils/validateModelDraft';

test('renders compact model build summary from draft and validation', () => {
  const draft = createInitialDraft();
  draft.basic_info.scenario = '电力调度';
  draft.basic_info.builder_mode = 'component_based';
  draft.components = [{
    component_id: 'startup_logic',
    parameter_bindings: [
      { component_parameter: 'load', model_parameter: 'load' },
      { component_parameter: 'startup_cost', required: true },
    ],
  }];

  render(<ModelBuildSummaryBar draft={draft} validation={validateModelDraft(draft)} />);

  expect(screen.getByLabelText('当前建模状态摘要')).toBeInTheDocument();
  expect(screen.getByText('电力调度')).toBeInTheDocument();
  expect(screen.getByText('组件化 Builder')).toBeInTheDocument();
  expect(screen.getByText('1 个组件')).toBeInTheDocument();
  expect(screen.getByText('参数绑定 1/2')).toBeInTheDocument();
});

test('renders first blocker inside summary bar', () => {
  const draft = createInitialDraft();
  const validation = validateModelDraft(draft);

  render(
    <ModelBuildSummaryBar
      draft={draft}
      validation={validation}
      blocker={{
        stepIndex: 1,
        stepTitle: '模型语义',
        sectionKey: 'semantic_structure',
        error: '至少需要一个变量',
      }}
    />,
  );

  expect(screen.getByRole('status')).toHaveTextContent('阻断项：第 2 步 模型语义 - 至少需要一个变量');
});
