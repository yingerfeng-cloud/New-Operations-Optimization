import { act, renderHook } from '@testing-library/react';
import { useSectionNavigation } from '../../features/model-creation/hooks/useSectionNavigation';

test('initial section tracking does not overwrite a saved recovery location', () => {
  const onActiveChange = vi.fn();
  const items = [{ key: 'creation', label: '创建方式' }, { key: 'model', label: '模型信息' }];
  const { result, rerender } = renderHook(({ resetKey }) => useSectionNavigation({
    items, resetKey, containerId: 'model-step-content', scrollContainer: null, onActiveChange,
  }), { initialProps: { resetKey: 0 } });
  expect(onActiveChange).not.toHaveBeenCalled();
  act(() => result.current.navigate('model'));
  expect(onActiveChange).toHaveBeenLastCalledWith('model');
  onActiveChange.mockClear();
  rerender({ resetKey: 1 });
  expect(onActiveChange).not.toHaveBeenCalled();
});
