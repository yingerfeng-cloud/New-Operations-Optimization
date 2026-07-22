export interface ModelValidationIssueLocation {
  stepIndex: number;
  sectionKey: string;
  tabKey?: string;
  collapseKeys?: string[];
  fieldCode?: string;
  objectId?: string;
  focusMode?: string;
}

export interface ModelNavigationCommand extends ModelValidationIssueLocation {
  requestId: string;
}

export type ModelNavigationResult = 'exact' | 'section' | 'missing';

function nextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

export async function executeModelNavigationCommand(command: ModelNavigationCommand, container: HTMLElement | null): Promise<ModelNavigationResult> {
  if (!container) return 'missing';
  command.collapseKeys?.forEach(key => {
    const item = container.querySelector<HTMLElement>(`.ant-collapse-item[data-node-key="${key}"]`);
    if (item && !item.classList.contains('ant-collapse-item-active')) item.querySelector<HTMLElement>('.ant-collapse-header')?.click();
  });
  await nextFrame();
  if (command.tabKey) container.querySelector<HTMLElement>(`.ant-tabs-tab[data-node-key="${command.tabKey}"]`)?.click();
  await nextFrame();

  const exact = command.fieldCode
    ? container.querySelector<HTMLElement>(`[data-field-code="${command.fieldCode}"]`)
    : command.objectId ? container.querySelector<HTMLElement>(`[data-object-id="${command.objectId}"]`) : null;
  const section = container.querySelector<HTMLElement>(`#model-section-${command.sectionKey}, [data-section-key="${command.sectionKey}"]`);
  const target = exact || section;
  if (!target) return 'missing';
  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  target.classList.add('model-navigation-highlight');
  (target.matches('input,textarea,button,[tabindex]') ? target : target.querySelector<HTMLElement>('input,textarea,button,[tabindex]'))?.focus();
  window.setTimeout(() => target.classList.remove('model-navigation-highlight'), 1800);
  return exact ? 'exact' : 'section';
}
