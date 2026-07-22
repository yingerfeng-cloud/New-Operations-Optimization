import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { StepSectionNav } from '../../features/model-creation/components/StepSectionNav';
import { ModelInspectionDrawer } from '../../features/model-creation/components/ModelInspectionDrawer';
import { createInitialDraft } from '../../features/model-creation/stores/modelCreationStore';
import { validateModelDraft } from '../../features/model-creation/utils/validateModelDraft';

test('step section navigation renders anchors and selects a section', () => {
  const scrollContainer = document.createElement('main');
  const windowScrollSpy = vi.spyOn(window, 'addEventListener');
  const containerScrollSpy = vi.spyOn(scrollContainer, 'addEventListener');
  render(<><StepSectionNav containerId="content" scrollContainer={scrollContainer} resetKey={1} items={[{ key: 'a', label: '基础信息' }, { key: 'b', label: '目标策略' }]} /><div id="content"><h3 data-section-key="a">基础信息</h3><h3 data-section-key="b">目标策略</h3></div></>);
  expect(containerScrollSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
  expect(windowScrollSpy.mock.calls.filter(([event]) => event === 'scroll')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '目标策略' }));
  expect(screen.getByRole('button', { name: '目标策略' })).toHaveClass('active');
});

test('model inspection opens with summary, blockers and navigation', () => {
  const draft = createInitialDraft(); const onNavigate = vi.fn();
  render(<ModelInspectionDrawer open draft={draft} workspace={{ mode: 'new', sessionId: 's', initialized: true, dirty: true }} validation={validateModelDraft(draft)} steps={[{ title: '基础信息', description: '', sectionKeys: ['basic_info'] }, { title: '模型语义', description: '', sectionKeys: ['semantic_structure', 'component_dependencies', 'parameter_bindings'] }, { title: '数学展开', description: '', sectionKeys: ['formula', 'problem_type'] }, { title: '运行参数', description: '', sectionKeys: ['runtime_parameters'] }, { title: '校验发布', description: '', sectionKeys: ['solver_compatibility'] }]} tested={false} onClose={vi.fn()} onNavigate={onNavigate} />);
  expect(screen.getByText('模型摘要')).toBeInTheDocument();
  expect(screen.getByText('发布条件')).toBeInTheDocument();
  fireEvent.click(screen.getAllByText('前往处理')[0]);
  expect(onNavigate).toHaveBeenCalled();
});
