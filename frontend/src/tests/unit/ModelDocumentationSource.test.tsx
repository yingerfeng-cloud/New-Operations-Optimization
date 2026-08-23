import { render, screen } from '@testing-library/react';
import { ModelDemoPanel } from '../../features/model-center/ModelAssetPanels';
import { buildModelDraftPayload } from '../../features/model-creation/utils/saveModelDraftAsset';
import { createBlankDraft } from '../../features/model-creation/stores/modelCreationStore';
import type { ModelAsset } from '../../types/model';

test('model documentation is read from the saved model definition', () => {
  const model: ModelAsset = {
    id: 'model-doc',
    name: '动态模型说明',
    template_id: 'custom_hydro',
    scene: '水电调度',
    version: 'v1',
    status: 'trial',
    solver: 'HiGHS',
    problem_type: 'MILP',
    model_problem_type: 'MILP',
    build_mode: 'component_based',
    updated_at: '2026-07-30',
    ui_metadata: { description: '这是从建模流程保存的说明。' },
    parameters: {
      function_asset_bindings: {
        power_surface: 'custom_power_surface_v2',
      },
    },
    component_spec: {
      components: [
        { type: 'function_mapping_2d_component', name: '二维出力曲面' },
      ],
    },
  };

  render(<ModelDemoPanel model={model} />);

  expect(screen.getByText('内容来自已保存的模型定义')).toBeInTheDocument();
  expect(screen.getByText('这是从建模流程保存的说明。')).toBeInTheDocument();
  expect(screen.getAllByText('custom_power_surface_v2').length).toBeGreaterThan(0);
  expect(screen.getByText('component_based')).toBeInTheDocument();
});

test('model description is persisted in ui metadata by the creation flow', () => {
  const draft = createBlankDraft();
  draft.basic_info.name = '可说明模型';
  draft.basic_info.scenario = '测试场景';
  draft.advanced.description = '由基础信息步骤维护的模型说明';

  const payload = buildModelDraftPayload(draft);

  expect(payload.ui_metadata.description).toBe('由基础信息步骤维护的模型说明');
  expect(payload.ui_metadata.documentation_source).toBe('model_creation');
});
