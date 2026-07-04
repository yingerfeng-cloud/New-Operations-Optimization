import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ParameterBindingDrawer } from '../../features/model-creation/components/ParameterBindingDrawer';
import { createInitialDraft } from '../../features/model-creation/stores/modelCreationStore';

test('renders binding context and saves validation status', async () => {
  const draft = createInitialDraft();
  const binding = { component_parameter: 'startup_cost', required: true, unit: '元/次', indices: ['time'] };
  draft.semantic.parameters = [{ code: 'startup_cost', name: '启动成本', unit: '元/次', sourceType: 'runtime', required: true }];
  draft.components = [{
    component_id: 'startup_logic',
    name: '启停逻辑组件',
    parameter_bindings: [binding],
  }];
  const onSave = vi.fn();
  const onClose = vi.fn();

  render(
    <ParameterBindingDrawer
      draft={draft}
      open
      target={{ componentIndex: 0, parameterCode: 'startup_cost', binding }}
      onSave={onSave}
      onClose={onClose}
    />,
  );

  expect(screen.getByText('编辑参数绑定')).toBeInTheDocument();
  expect(screen.getByText('启停逻辑组件 / startup_cost')).toBeInTheDocument();
  expect(screen.getByText('仍缺少 startup_cost 的必填映射')).toBeInTheDocument();

  fireEvent.click(screen.getByText('保存并校验'));

  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(await screen.findByText('请选择模型参数或填写运行参数键')).toBeInTheDocument();

  fireEvent.click(screen.getByText('保存草稿'));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ parameterCode: 'startup_cost' }), expect.objectContaining({ status: 'missing' }));
  expect(onClose).toHaveBeenCalled();
});
