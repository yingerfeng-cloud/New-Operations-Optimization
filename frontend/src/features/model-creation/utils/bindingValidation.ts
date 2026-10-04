export type BindingRow = {
  code: string;
  name: string;
  binding: Record<string, unknown>;
};

export function hasBindingValue(value: unknown) {
  return value !== undefined && value !== null && value !== '';
}

export function bindingCode(binding: Record<string, unknown>, index = 0) {
  return String(binding.component_parameter || binding.parameter || binding.parameter_code || binding.code || `parameter_${index + 1}`);
}

export function bindingSourceType(binding: Record<string, unknown>) {
  return String(binding.source_type || binding.sourceType || binding.source_system || binding.sourceSystem || binding.binding_type || 'runtime');
}

export function isBindingComplete(binding: Record<string, unknown>) {
  const sourceType = bindingSourceType(binding);
  if (sourceType === 'function_asset') {
    return hasBindingValue(binding.function_asset_id);
  }
  if (sourceType === 'static') {
    return hasBindingValue(binding.value) || hasBindingValue(binding.default_value) || hasBindingValue(binding.defaultValue) || hasBindingValue(binding.default);
  }
  if (sourceType === 'runtime' || sourceType === 'ledger' || sourceType === 'system') {
    return hasBindingValue(binding.runtime_key) || hasBindingValue(binding.model_parameter);
  }
  return hasBindingValue(binding.runtime_key) || hasBindingValue(binding.model_parameter);
}

function componentRows(component: Record<string, unknown>, key: string) {
  const value = component[key];
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function schemaRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item !== undefined && item !== null)
    .map(item => {
      if (typeof item === 'string' || typeof item === 'number') {
        return { code: String(item), name: String(item) };
      }
      return item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
    })
    .filter(item => Boolean(item.code || item.key || item.name || item.parameter || item.parameter_code));
}

/**
 * Return the input contract of a component, rather than every parameter that
 * happens to be present in a legacy component definition.  Built-in hydro
 * definitions historically carried the full model parameter catalog in
 * `parameters`, while `inputs` is the authoritative list of parameters that
 * the component actually consumes.
 */
export function componentParameterDefinitions(component: Record<string, unknown>): Array<Record<string, unknown>> {
  const direct = schemaRows(component.parameters);
  if (direct.length) return direct;
  const definition = component.definition && typeof component.definition === 'object' && !Array.isArray(component.definition)
    ? component.definition as Record<string, unknown>
    : {};
  const definitionParameters = schemaRows(definition.parameters);
  const inputRows = schemaRows(definition.inputs);
  if (!inputRows.length) return definitionParameters;
  const byCode = new Map(definitionParameters.map(row => [String(row.code || row.key || row.name || row.parameter || row.parameter_code), row]));
  return inputRows.map(input => {
    const code = String(input.code || input.key || input.name || input.parameter || input.parameter_code || '');
    return { ...(byCode.get(code) || {}), ...input, code };
  });
}

export function getComponentBindingRows(component: Record<string, unknown>): BindingRow[] {
  const explicit = componentRows(component, 'parameter_bindings');
  const parameters = componentParameterDefinitions(component);
  const rows: BindingRow[] = parameters.map((parameter, index) => {
    const code = String(parameter.code || parameter.parameter || parameter.component_parameter || `parameter_${index + 1}`);
    const saved = explicit.find(binding => bindingCode(binding) === code);
    return {
      code,
      binding: {
        component_parameter: code,
        parameter: code,
        required: parameter.required ?? true,
        unit: parameter.unit,
        indices: extractDimensions(parameter),
        source_type: parameter.source_type || parameter.sourceType || parameter.source_system || 'runtime',
        type: parameter.type || parameter.data_type || parameter.value_type,
        ...(saved || {}),
      },
      name: String(saved?.name || saved?.parameter_name || parameter.name || code),
    };
  });
  const known = new Set(rows.map(row => row.code));
  explicit.forEach((binding, index) => {
    const code = bindingCode(binding, index);
    if (known.has(code)) return;
    rows.push({
      code,
      binding,
      name: String(binding.name || binding.parameter_name || binding.component_parameter || code),
    });
  });
  return rows;
}

export function getMissingBindingRows(component: Record<string, unknown>) {
  return getComponentBindingRows(component).filter(row => row.binding.required !== false && !isBindingComplete(row.binding));
}
import { extractDimensions } from './modelDimensions';
