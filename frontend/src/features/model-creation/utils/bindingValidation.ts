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
  const explicit = componentRows(component, 'parameter_bindings').map((binding, index) => ({
    code: bindingCode(binding, index),
    binding,
    name: String(binding.name || binding.parameter_name || binding.component_parameter || bindingCode(binding, index)),
  }));
  if (explicit.length) return explicit;
  return componentRows(component, 'parameters').map((parameter, index) => {
    const code = String(parameter.code || parameter.parameter || parameter.component_parameter || `parameter_${index + 1}`);
    return {
      code,
      binding: {
        component_parameter: code,
        parameter: code,
        required: parameter.required ?? true,
        unit: parameter.unit,
        indices: parameter.indices || parameter.dimension,
        source_type: parameter.source_type || parameter.sourceType || parameter.source_system || 'runtime',
        type: parameter.type || parameter.data_type || parameter.value_type,
      },
      name: String(parameter.name || code),
    };
  });
}

export function getMissingBindingRows(component: Record<string, unknown>) {
  return getComponentBindingRows(component).filter(row => row.binding.required !== false && !isBindingComplete(row.binding));
}
