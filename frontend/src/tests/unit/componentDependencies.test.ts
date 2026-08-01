import { describe, expect, test } from 'vitest';
import {
  materializeComponentSelection,
  resolveComponentSelection,
} from '../../features/model-creation/components/ComponentPickerDrawer';
import type { ComponentDef } from '../../types/component';
import {
  analyzeComponentDependencyCandidate,
  analyzeComponentDependencies,
  componentDependencyErrors,
  getComponentDependencyIds,
  getDependentComponentIds,
} from '../../utils/componentDependencies';

function component(id: string, dependencies: string[] = [], extra: Partial<ComponentDef> = {}): ComponentDef {
  return {
    component_id: id,
    type: id,
    name: id,
    status: 'published',
    enabled: true,
    implemented: true,
    version: '1.0.0',
    depends_on: dependencies,
    ...extra,
  };
}

describe('component dependency graph', () => {
  test('normalizes and de-duplicates both dependency field names', () => {
    expect(getComponentDependencyIds({
      depends_on: [' base ', 'shared'],
      dependencies: ['shared', 'legacy', ''],
    })).toEqual(['base', 'shared', 'legacy']);
  });

  test('detects missing, self and cyclic dependencies while ignoring disabled components', () => {
    const analysis = analyzeComponentDependencies([
      component('missing_owner', ['not_selected']),
      component('self_owner', ['self_owner']),
      component('cycle_a', ['cycle_b']),
      component('cycle_b', ['cycle_a']),
      component('disabled_owner', ['also_missing'], { enabled: false }),
    ]);

    expect(analysis.missing).toEqual([{ componentId: 'missing_owner', dependencyId: 'not_selected' }]);
    expect(analysis.selfDependencies).toEqual(['self_owner']);
    expect(analysis.cycles).toEqual([['cycle_a', 'cycle_b', 'cycle_a']]);
  });

  test('finds all transitive dependents for safe cascade removal', () => {
    expect(getDependentComponentIds('base', [
      component('base'),
      component('child', ['base']),
      component('grandchild', ['child']),
      component('unrelated'),
    ])).toEqual(['child', 'grandchild']);
  });

  test('allows multiple instances of one component type without cascading while another instance remains', () => {
    const components = [
      component('base'),
      component('base'),
      component('child', ['base']),
    ];

    expect(analyzeComponentDependencies(components).missing).toEqual([]);
    expect(componentDependencyErrors(components)).toEqual([]);
    expect(getDependentComponentIds('base', components)).toEqual([]);
  });

  test('does not cascade from a disabled instance but protects dependents when the last enabled instance is removed', () => {
    const components = [
      component('base', [], { enabled: false }),
      component('base'),
      component('child', ['base']),
      component('disabled_child', ['base'], { enabled: false }),
    ];

    expect(getDependentComponentIds('base', components, 0)).toEqual([]);
    expect(getDependentComponentIds('base', components, 1)).toEqual(['child']);
  });

  test('applying catalog selection preserves every configured instance of the same component type', () => {
    const definition = component('function_mapping_component', ['base']);
    const existing = [
      { ...definition, function_asset_id: 'curve_a', depends_on: [] },
      { ...definition, function_asset_id: 'curve_b', depends_on: [] },
    ];

    const materialized = materializeComponentSelection(
      ['function_mapping_component', 'base'],
      [definition, component('base')],
      existing,
    );

    expect(materialized).toHaveLength(3);
    expect(materialized.slice(0, 2).map(item => item.function_asset_id)).toEqual(['curve_a', 'curve_b']);
    expect(materialized.slice(0, 2).every(item => getComponentDependencyIds(item).includes('base'))).toBe(true);
  });

  test('marks every participant when a strongly connected graph has overlapping cycles', () => {
    const analysis = analyzeComponentDependencies([
      component('a', ['b', 'c']),
      component('b', ['d']),
      component('c', ['d']),
      component('d', ['a']),
    ]);

    expect(new Set(analysis.cycles.flat())).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(analysis.cycles).toEqual([
      ['a', 'b', 'd', 'a'],
      ['a', 'c', 'd', 'a'],
    ]);
  });

  test('selection resolves transitive dependencies and reports unavailable or cyclic graphs', () => {
    const resolved = resolveComponentSelection(['top'], [
      component('top', ['middle']),
      component('middle', ['base']),
      component('base'),
    ]);
    expect(resolved.ids).toEqual(['top', 'middle', 'base']);
    expect(resolved.autoAdded).toEqual(['middle', 'base']);
    expect(resolved.missing).toEqual([]);

    const unavailable = resolveComponentSelection(['top'], [
      component('top', ['offline']),
      component('offline', [], { status: 'offline', enabled: false }),
    ]);
    expect(unavailable.missing).toEqual(['top → offline（不可用）']);

    const cyclic = resolveComponentSelection(['cycle_a'], [
      component('cycle_a', ['cycle_b']),
      component('cycle_b', ['cycle_a']),
    ]);
    expect(cyclic.cycles).toEqual([['cycle_a', 'cycle_b', 'cycle_a']]);
  });

  test('candidate validation derives existence and availability from catalog definitions', () => {
    const result = analyzeComponentDependencyCandidate(
      component('candidate', ['published_dependency', 'offline_dependency', 'missing_dependency']),
      [
        component('published_dependency'),
        component('offline_dependency', [], { status: 'offline', enabled: false }),
      ],
    );

    expect(result.missing).toEqual(['missing_dependency']);
    expect(result.unavailable).toEqual(['offline_dependency']);
    expect(result.selfDependency).toBe(false);
    expect(result.cycles).toEqual([]);
  });
});
