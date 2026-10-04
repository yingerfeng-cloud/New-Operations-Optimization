import type { ModelDraft } from '../stores/modelCreationStore';
import { bindingCode, componentParameterDefinitions, isBindingComplete } from './bindingValidation';
import { extractDimensions } from './modelDimensions';

type DraftComponent = ModelDraft['components'][number];
type ModelParameter = ModelDraft['semantic']['parameters'][number];

function normalizedUnit(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase();
}

function compatible(componentParameter: Record<string, unknown>, modelParameter: ModelParameter) {
  const expectedDimensions = extractDimensions(componentParameter);
  const actualDimensions = extractDimensions(modelParameter as unknown as Record<string, unknown>);
  // An old component catalog used an empty dimension for a few inputs (notably
  // `edges`) even though the model contract declared the dimension.  Treat an
  // empty component dimension as unspecified, but keep strict matching when
  // both sides provide dimensions.
  if (expectedDimensions.length && !actualDimensions.length) return false;
  if (expectedDimensions.length && actualDimensions.length && (expectedDimensions.length !== actualDimensions.length || expectedDimensions.some((value, index) => value !== actualDimensions[index]))) return false;
  const expectedUnit = normalizedUnit(componentParameter.unit);
  const actualUnit = normalizedUnit(modelParameter.unit);
  return !expectedUnit || !actualUnit || expectedUnit === actualUnit;
}

/** Infer a binding only when code, ordered dimensions and units identify one parameter. */
export function reconcileComponentParameterBindings(
  modelParameters: ModelParameter[],
  components: DraftComponent[],
): DraftComponent[] {
  return components.map(component => {
    const explicit = Array.isArray(component.parameter_bindings)
      ? component.parameter_bindings.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      : [];
    const explicitByCode = new Map(explicit.map((binding, index) => [bindingCode(binding, index), binding]));
    const parameterCodes = new Set<string>();
    const nextBindings: Array<Record<string, unknown>> = [];

    componentParameterDefinitions(component).forEach(parameter => {
      const code = String(parameter.code || parameter.parameter || parameter.component_parameter || '').trim();
      if (!code) return;
      parameterCodes.add(code);
      const saved = explicitByCode.get(code);
      if (saved && saved.binding_origin !== 'auto_exact' && isBindingComplete(saved)) {
        nextBindings.push(saved);
        return;
      }
      const matches = modelParameters.filter(modelParameter => modelParameter.code === code && compatible(parameter, modelParameter));
      if (matches.length === 1) {
        const modelParameter = matches[0];
        nextBindings.push({
          ...(saved || {}),
          component_parameter: code,
          parameter: code,
          model_parameter: modelParameter.code,
          runtime_key: modelParameter.code,
          source_type: 'runtime',
          required: parameter.required !== false,
          unit: parameter.unit || modelParameter.unit,
          indices: extractDimensions(parameter),
          status: 'bound',
          binding_origin: 'auto_exact',
        });
      } else if (saved && saved.binding_origin !== 'auto_exact') {
        nextBindings.push(saved);
      }
    });

    explicit.forEach((binding, index) => {
      if (!parameterCodes.has(bindingCode(binding, index))) nextBindings.push(binding);
    });
    return { ...component, parameter_bindings: nextBindings };
  });
}
