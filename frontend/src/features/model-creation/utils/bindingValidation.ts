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

export function getComponentBindingRows(component: Record<string, unknown>): BindingRow[] {
  const explicit = componentRows(component, 'parameter_bindings');
  const definition = component.definition && typeof component.definition === 'object' && !Array.isArray(component.definition)
    ? component.definition as Record<string, unknown>
    : {};
  const parameters = componentRows(component, 'parameters').length
    ? componentRows(component, 'parameters')
    : componentRows(definition, 'parameters');
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
