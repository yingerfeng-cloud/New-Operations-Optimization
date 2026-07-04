import type { ModelDraft } from '../stores/modelCreationStore';

export interface NonlinearDiagnostic {
  expression: string;
  nonlinear_type: 'bilinear' | 'division' | 'quadratic' | 'high_order_power' | 'function_1d' | 'function_2d' | 'general_nonlinear_function';
  involved_variables: string[];
  recommended_strategy: string[];
  supported_by_current_solver: boolean;
  risk_level: 'low' | 'medium' | 'high';
  message: string;
  converted?: boolean;
  blocking?: boolean;
  source?: string;
}

export interface NonlinearReport {
  count: number;
  relationships: NonlinearDiagnostic[];
  blocking_items: NonlinearDiagnostic[];
  warning_items: NonlinearDiagnostic[];
  has_blocking_nonlinearity: boolean;
}

const GENERAL_FUNCTIONS = new Set(['exp', 'log', 'sin', 'cos', 'sqrt', 'tan']);

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function variableRefPattern(variableCodes: string[]) {
  const codes = variableCodes.map(escapeRegExp).join('|');
  return codes ? new RegExp(`\\b(${codes})(?:\\[[^\\]]+\\])?`, 'g') : undefined;
}

function variableRefs(text: string, variableCodes: string[]) {
  const pattern = variableRefPattern(variableCodes);
  if (!pattern) return [];
  return [...text.matchAll(pattern)].map(match => match[0]);
}

function baseName(expression: string) {
  return expression.trim().match(/^([A-Za-z_]\w*)/)?.[1] || '';
}

function dedupe(rows: NonlinearDiagnostic[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = `${row.source}|${row.expression}|${row.nonlinear_type}|${row.involved_variables.join(',')}|${row.converted ? '1' : '0'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function analyzeFormulaText(expression: string, variableCodes: string[], source?: string): NonlinearDiagnostic[] {
  const text = expression.trim();
  if (!text) return [];
  const rows: NonlinearDiagnostic[] = [];
  const refs = variableRefs(text, variableCodes);
  const relationSides = text.split(/==|<=|>=/).map(side => side.trim()).filter(Boolean);
  const productSide = relationSides.find(side => side.includes('*') && side.split('*').filter(part => variableRefs(part, variableCodes).length > 0).length >= 2) || text;
  const factors = productSide.split('*').map(item => item.trim());
  const factorVars = factors.map(item => variableRefs(item, variableCodes)[0]).filter(Boolean);
  if (factorVars.length >= 2) {
    const pair = factorVars.slice(0, 2);
    rows.push({
      expression: text,
      nonlinear_type: 'bilinear',
      involved_variables: pair,
      recommended_strategy: ['mccormick_relaxation', 'piecewise_2d', 'nlp_reserved'],
      supported_by_current_solver: false,
      risk_level: 'high',
      message: `检测到双线性项 ${pair[0]} * ${pair[1]}。当前 HiGHS 不能直接求解。可选策略：McCormick 松弛 / 二维 PWL / NLP 预留。`,
      blocking: true,
      source,
    });
  }
  const divisionParts = text.split('/');
  if (divisionParts.length > 1 && divisionParts.slice(1).some(part => variableRefs(part, variableCodes).length > 0)) {
    rows.push({
      expression: text,
      nonlinear_type: 'division',
      involved_variables: refs,
      recommended_strategy: ['piecewise_1d', 'piecewise_2d', 'nlp_reserved'],
      supported_by_current_solver: false,
      risk_level: 'high',
      message: '检测到变量除法，当前 HiGHS 不能直接求解。',
      blocking: true,
      source,
    });
  }
  for (const ref of refs) {
    const power = text.match(new RegExp(`${escapeRegExp(ref)}\\s*(?:\\^|\\*\\*)\\s*(\\d+)`));
    if (power) {
      const exponent = Number(power[1]);
      rows.push({
        expression: text,
        nonlinear_type: exponent === 2 ? 'quadratic' : 'high_order_power',
        involved_variables: [ref],
        recommended_strategy: exponent === 2 ? ['qp', 'piecewise_1d'] : ['piecewise_1d', 'nlp_reserved'],
        supported_by_current_solver: exponent === 2,
        risk_level: exponent === 2 ? 'medium' : 'high',
        message: exponent === 2 ? '检测到二次项 x^2，可选择 QP 或 PWL。' : '检测到高次幂项，建议 PWL 或 NLP 预留。',
        blocking: exponent !== 2,
        source,
      });
    }
  }
  for (const match of text.matchAll(/\b([A-Za-z_]\w*)\s*\(([^()]*)\)/g)) {
    const fn = match[1];
    if (['sum', 'min', 'max'].includes(fn)) continue;
    const args = match[2].split(',').map(item => item.trim()).filter(Boolean);
    const involved = args.flatMap(arg => variableRefs(arg, variableCodes));
    if (!involved.length) continue;
    const general = GENERAL_FUNCTIONS.has(fn);
    const type = general ? 'general_nonlinear_function' : args.length >= 2 ? 'function_2d' : 'function_1d';
    const converted = fn === 'piecewise' || fn === 'piecewise_2d';
    rows.push({
      expression: text,
      nonlinear_type: type,
      involved_variables: [...new Set(involved)],
      recommended_strategy: general ? ['nlp_reserved'] : type === 'function_2d' ? ['piecewise_2d'] : ['piecewise_1d'],
      supported_by_current_solver: converted,
      risk_level: converted ? 'low' : general ? 'high' : 'medium',
      message: converted ? '函数资产已通过 PWL 组件转换。' : general ? `检测到 ${fn}(...) 一般非线性函数。` : '检测到函数资产映射，建议使用 PWL 组件。',
      converted,
      blocking: !converted && general,
      source,
    });
  }
  return dedupe(rows);
}

function finite(value: unknown) {
  return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
}

function componentType(component: Record<string, unknown>) {
  return String(component.type || component.component_id || '');
}

function mccormickCovers(component: Record<string, unknown>, pair: string[]) {
  if (componentType(component) !== 'mccormick_bilinear_relaxation_component') return false;
  const x = baseName(String(component.x || ''));
  const y = baseName(String(component.y || ''));
  const pairBases = pair.map(baseName);
  return pairBases.includes(x) && pairBases.includes(y);
}

export function analyzeDraftNonlinear(draft: ModelDraft): NonlinearReport {
  const variableCodes = draft.semantic.variables.map(variable => variable.code).filter(Boolean);
  const rows: NonlinearDiagnostic[] = [];
  for (const [index, formula] of draft.formulas.entries()) {
    rows.push(...analyzeFormulaText(formula.dsl_formula, variableCodes, `formulas[${index}]`).map(row => {
      if (row.nonlinear_type === 'bilinear' && draft.components.some(component => mccormickCovers(component, row.involved_variables))) {
        return { ...row, converted: true, supported_by_current_solver: true, blocking: false, risk_level: 'medium' as const, message: '双线性项已配置 McCormick 松弛；这是松弛，不是精确等价表达。' };
      }
      return row;
    }));
  }
  for (const [index, component] of draft.components.entries()) {
    const type = componentType(component);
    if (type === 'function_mapping_component' || type === 'piecewise_linear_curve') {
      rows.push({ expression: `${String(component.y || 'y')} == f(${String(component.x || 'x')})`, nonlinear_type: 'function_1d', involved_variables: [String(component.x || '')].filter(Boolean), recommended_strategy: ['piecewise_1d'], supported_by_current_solver: true, risk_level: 'low', message: '一维函数资产已转换为 piecewise_1d。', converted: true, blocking: false, source: `components[${index}]` });
    }
    if (type === 'function_mapping_2d_component') {
      rows.push({ expression: `${String(component.z || 'z')} == f(${String(component.x || 'x')}, ${String(component.y || 'y')})`, nonlinear_type: 'function_2d', involved_variables: [String(component.x || ''), String(component.y || '')].filter(Boolean), recommended_strategy: ['piecewise_2d'], supported_by_current_solver: true, risk_level: 'medium', message: '二维函数资产已转换为 piecewise_2d；注意 MILP 规模风险。', converted: true, blocking: false, source: `components[${index}]` });
    }
    if (type === 'mccormick_bilinear_relaxation_component') {
      const boundsOk = ['x_lower', 'x_upper', 'y_lower', 'y_upper'].every(key => finite(component[key]));
      rows.push({ expression: `${String(component.w || 'w')} ~= ${String(component.x || 'x')} * ${String(component.y || 'y')}`, nonlinear_type: 'bilinear', involved_variables: [String(component.x || ''), String(component.y || '')].filter(Boolean), recommended_strategy: ['mccormick_relaxation'], supported_by_current_solver: boundsOk, risk_level: boundsOk ? 'medium' : 'high', message: boundsOk ? '双线性项已配置 McCormick 松弛；结果存在松弛误差风险。' : 'McCormick 缺少 x/y 有限上下界，必须补齐后才能发布。', converted: boundsOk, blocking: !boundsOk, source: `components[${index}]` });
    }
  }
  const relationships = dedupe(rows);
  const blocking_items = relationships.filter(item => item.blocking);
  return { count: relationships.length, relationships, blocking_items, warning_items: relationships.filter(item => !item.blocking && ['medium', 'high'].includes(item.risk_level)), has_blocking_nonlinearity: blocking_items.length > 0 };
}

export function firstBilinearDiagnostic(draft: ModelDraft) {
  return analyzeDraftNonlinear(draft).relationships.find(item => item.nonlinear_type === 'bilinear' && !item.converted);
}
