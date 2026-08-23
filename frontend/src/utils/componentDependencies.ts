export type ComponentLike = Record<string, unknown>;

export interface MissingComponentDependency {
  componentId: string;
  dependencyId: string;
}

export interface ComponentDependencyAnalysis {
  missing: MissingComponentDependency[];
  selfDependencies: string[];
  cycles: string[][];
}

export interface ComponentDependencyCandidateAnalysis {
  missing: string[];
  unavailable: string[];
  selfDependency: boolean;
  cycles: string[][];
}

export const COMPONENT_PUBLISHED_STATUS = 'published';

function normalizedText(value: unknown) {
  return String(value ?? '').trim();
}

export function getComponentId(component: ComponentLike) {
  return normalizedText(component.component_id || component.type || component.code);
}

export function getComponentName(component: ComponentLike, fallback = '未命名组件') {
  return normalizedText(component.display_name || component.name || getComponentId(component)) || fallback;
}

export function getComponentDependencyIds(component: ComponentLike) {
  const values = [
    ...(Array.isArray(component.depends_on) ? component.depends_on : []),
    ...(Array.isArray(component.dependencies) ? component.dependencies : []),
  ];
  return [...new Set(values.map(normalizedText).filter(Boolean))];
}

export function isPublishedComponent(component: ComponentLike) {
  const status = normalizedText(component.status).toLowerCase();
  return status === COMPONENT_PUBLISHED_STATUS;
}

function canonicalCycle(cycle: string[]) {
  const nodes = cycle.slice(0, -1);
  if (!nodes.length) return [];
  const rotations = nodes.map((_, index) => [...nodes.slice(index), ...nodes.slice(0, index)]);
  rotations.sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000')));
  return [...rotations[0], rotations[0][0]];
}

export function findComponentDependencyCycles(graph: Map<string, string[]>) {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const stronglyConnected: string[][] = [];
  const cycles = new Map<string, string[]>();

  const connect = (id: string) => {
    indices.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
    (graph.get(id) || []).forEach(dependencyId => {
      if (!graph.has(dependencyId)) return;
      if (!indices.has(dependencyId)) {
        connect(dependencyId);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(dependencyId)!));
      } else if (onStack.has(dependencyId)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(dependencyId)!));
      }
    });
    if (lowLinks.get(id) === indices.get(id)) {
      const members: string[] = [];
      let member = '';
      do {
        member = stack.pop()!;
        onStack.delete(member);
        members.push(member);
      } while (member !== id);
      stronglyConnected.push(members);
    }
  };

  const pathWithin = (from: string, target: string, members: Set<string>) => {
    const queue: string[][] = [[from]];
    const visited = new Set([from]);
    while (queue.length) {
      const path = queue.shift()!;
      const current = path.at(-1)!;
      if (current === target) return path;
      (graph.get(current) || []).filter(id => members.has(id)).sort().forEach(next => {
        if (visited.has(next)) return;
        visited.add(next);
        queue.push([...path, next]);
      });
    }
    return undefined;
  };

  [...graph.keys()].sort().forEach(id => {
    if (!indices.has(id)) connect(id);
  });
  stronglyConnected.forEach(component => {
    const members = new Set(component);
    if (component.length === 1) {
      const id = component[0];
      if ((graph.get(id) || []).includes(id)) {
        cycles.set(`${id}\u0000${id}`, [id, id]);
      }
      return;
    }
    component.sort().forEach(start => {
      const neighbors = (graph.get(start) || []).filter(id => members.has(id)).sort();
      for (const neighbor of neighbors) {
        const path = pathWithin(neighbor, start, members);
        if (!path) continue;
        const cycle = canonicalCycle([start, ...path]);
        cycles.set(cycle.join('\u0000'), cycle);
        break;
      }
    });
  });
  return [...cycles.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, cycle]) => cycle);
}

export function analyzeComponentDependencies(components: ComponentLike[]): ComponentDependencyAnalysis {
  const enabled = components.filter(component => component.enabled !== false);
  const graph = new Map<string, string[]>();

  enabled.forEach(component => {
    const id = getComponentId(component);
    if (!id) return;
    graph.set(id, [...new Set([...(graph.get(id) || []), ...getComponentDependencyIds(component)])]);
  });

  const enabledIds = new Set(graph.keys());
  const selfDependencies: string[] = [];
  const missing: MissingComponentDependency[] = [];
  graph.forEach((dependencies, componentId) => {
    dependencies.forEach(dependencyId => {
      if (dependencyId === componentId) {
        selfDependencies.push(componentId);
      } else if (!enabledIds.has(dependencyId)) {
        missing.push({ componentId, dependencyId });
      }
    });
  });

  const cycles = findComponentDependencyCycles(graph)
    .filter(cycle => cycle.length > 2);
  return {
    missing,
    selfDependencies: [...new Set(selfDependencies)].sort(),
    cycles,
  };
}

export function analyzeComponentDependencyCandidate(
  component: ComponentLike,
  catalog: ComponentLike[],
): ComponentDependencyCandidateAnalysis {
  const currentId = getComponentId(component);
  const dependencies = getComponentDependencyIds(component);
  const catalogWithoutCurrent = catalog.filter(item => getComponentId(item) !== currentId);
  const analysis = analyzeComponentDependencies([
    ...catalogWithoutCurrent.map(item => ({ ...item, enabled: true })),
    { ...component, enabled: true },
  ]);
  const catalogById = new Map(catalogWithoutCurrent.map(item => [getComponentId(item), item]));
  return {
    missing: analysis.missing
      .filter(item => item.componentId === currentId)
      .map(item => item.dependencyId),
    unavailable: dependencies.filter(dependencyId => {
      const dependency = catalogById.get(dependencyId);
      return dependency !== undefined && !isPublishedComponent(dependency);
    }),
    selfDependency: analysis.selfDependencies.includes(currentId),
    cycles: analysis.cycles.filter(cycle => cycle.includes(currentId)),
  };
}

export function componentDependencyErrors(components: ComponentLike[]) {
  const analysis = analyzeComponentDependencies(components);
  return [
    ...analysis.selfDependencies.map(id => `${id} 不能依赖自身`),
    ...analysis.missing.map(item => `${item.componentId} 缺少依赖 ${item.dependencyId}`),
    ...analysis.cycles.map(cycle => `组件依赖存在循环：${cycle.join(' → ')}`),
  ];
}

export function getDependentComponentIds(targetId: string, components: ComponentLike[], removedIndex?: number) {
  if (removedIndex !== undefined) {
    if (components[removedIndex]?.enabled === false) return [];
    const hasAnotherEnabledInstance = components.some((component, index) => (
      index !== removedIndex
      && component.enabled !== false
      && getComponentId(component) === targetId
    ));
    if (hasAnotherEnabledInstance) return [];
  } else {
    const enabledTargetInstanceCount = components.filter(component => (
      component.enabled !== false && getComponentId(component) === targetId
    )).length;
    if (enabledTargetInstanceCount > 1) return [];
  }
  const reverse = new Map<string, Set<string>>();
  components.filter(component => component.enabled !== false).forEach(component => {
    const id = getComponentId(component);
    if (!id) return;
    getComponentDependencyIds(component).forEach(dependencyId => {
      const dependents = reverse.get(dependencyId) || new Set<string>();
      dependents.add(id);
      reverse.set(dependencyId, dependents);
    });
  });

  const result = new Set<string>();
  const queue = [targetId];
  while (queue.length) {
    const current = queue.shift()!;
    (reverse.get(current) || []).forEach(dependentId => {
      if (dependentId === targetId || result.has(dependentId)) return;
      result.add(dependentId);
      queue.push(dependentId);
    });
  }
  return [...result];
}
