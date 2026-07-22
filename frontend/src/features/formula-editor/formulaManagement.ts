import type { FormulaDef, FormulaVersionSnapshot } from '../../types/formula';
import { formulaVersionSnapshot } from './formulaVersioning';

export interface FormulaFilters {
  keyword?: string;
  kind?: FormulaDef['kind'] | 'all';
  status?: string;
  group?: string;
}

export function formulaSnapshot(formula: FormulaDef, savedAt = new Date().toISOString()): FormulaVersionSnapshot {
  return formulaVersionSnapshot(formula, savedAt);
}

export function filterFormulas(formulas: FormulaDef[], filters: FormulaFilters) {
  const keyword = filters.keyword?.trim().toLowerCase() || '';
  return formulas.filter(formula => {
    const haystack = [formula.name, formula.dsl_formula, ...(formula.referenced_variables || []), ...(formula.referenced_parameters || [])].join(' ').toLowerCase();
    return (!keyword || haystack.includes(keyword))
      && (!filters.kind || filters.kind === 'all' || formula.kind === filters.kind)
      && (!filters.status || filters.status === 'all' || formula.compile_status === filters.status || formula.solve_participation === filters.status)
      && (!filters.group || filters.group === 'all' || (formula.business_group || '未分组') === filters.group);
  });
}

export function moveFormula(formulas: FormulaDef[], formulaId: string, direction: -1 | 1) {
  const index = formulas.findIndex(item => item.formula_id === formulaId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= formulas.length) return formulas;
  const next = [...formulas];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function dependencyAnalysis(
  formulas: FormulaDef[],
  semantic: { sets: Array<{ code: string }>; parameters: Array<{ code: string }>; variables: Array<{ code: string }> },
) {
  const active = formulas.filter(item => (item.solve_participation || 'solve_active') === 'solve_active');
  const usedVariables = new Set(active.flatMap(item => item.referenced_variables || []));
  const usedParameters = new Set(active.flatMap(item => item.referenced_parameters || []));
  const usedSets = new Set(active.flatMap(item => [...(item.referenced_sets || []), ...((item.scope || []).map(scope => scope.set))]));
  const objectiveVariables = new Set(active.filter(item => item.kind === 'objective').flatMap(item => item.referenced_variables || []));
  const normalized = new Map<string, string[]>();
  active.filter(item => item.kind === 'constraint').forEach(item => {
    const key = item.dsl_formula.replace(/\s+/g, '').toLowerCase();
    normalized.set(key, [...(normalized.get(key) || []), item.formula_id]);
  });
  return {
    unusedVariables: semantic.variables.map(item => item.code).filter(code => !usedVariables.has(code)),
    unusedParameters: semantic.parameters.map(item => item.code).filter(code => !usedParameters.has(code)),
    unusedSets: semantic.sets.map(item => item.code).filter(code => !usedSets.has(code)),
    variablesOutsideObjective: [...usedVariables].filter(code => !objectiveVariables.has(code)),
    duplicateConstraintGroups: [...normalized.values()].filter(ids => ids.length > 1),
  };
}
