import { describe, expect, test } from 'vitest';
import { reconcileComponentParameterBindings } from '../../features/model-creation/utils/componentParameterBindings';
import { getComponentBindingRows } from '../../features/model-creation/utils/bindingValidation';
import type { ModelDraft } from '../../features/model-creation/stores/modelCreationStore';

const parameters = [
  { code: 'load', name: '负荷', unit: 'MW', indices: ['time'], dimension: ['time'], sourceType: 'runtime', required: true },
] as ModelDraft['semantic']['parameters'];

function component(parameter: Record<string, unknown>, bindings: Array<Record<string, unknown>> = []) {
  return [{ component_id: 'balance', definition: { parameters: [parameter] }, parameter_bindings: bindings }] as ModelDraft['components'];
}

describe('deterministic component parameter binding', () => {
  test('binds the unique same-code same-dimension parameter', () => {
    const [result] = reconcileComponentParameterBindings(parameters, component({ code: 'load', unit: 'MW', dimension: ['time'], required: true }));
    expect(result.parameter_bindings).toEqual([
      expect.objectContaining({ component_parameter: 'load', model_parameter: 'load', runtime_key: 'load', binding_origin: 'auto_exact' }),
    ]);
  });

  test('leaves incompatible dimensions unresolved', () => {
    const [result] = reconcileComponentParameterBindings(parameters, component({ code: 'load', unit: 'MW', dimension: ['region', 'time'], required: true }));
    expect(result.parameter_bindings).toEqual([]);
  });

  test('preserves a complete manual binding', () => {
    const manual = { component_parameter: 'load', source_type: 'runtime', runtime_key: 'approved_load', model_parameter: 'approved_load' };
    const [result] = reconcileComponentParameterBindings(parameters, component({ code: 'load', unit: 'MW', dimension: ['time'], required: true }, [manual]));
    expect(result.parameter_bindings).toEqual([manual]);
  });

  test('uses the component input contract instead of a legacy full parameter catalog', () => {
    const definition = {
      inputs: ['load'],
      parameters: [
        { code: 'load', unit: 'MW', dimension: ['time'], required: true },
        { code: 'unrelated_legacy_field', dimension: [], required: true },
      ],
    };
    const [result] = reconcileComponentParameterBindings(parameters, [{ component_id: 'balance', definition }] as ModelDraft['components']);
    const bindings = Array.isArray(result.parameter_bindings) ? result.parameter_bindings : [];
    expect(bindings).toHaveLength(1);
    expect(getComponentBindingRows(result)).toHaveLength(1);
    expect(bindings[0]).toEqual(expect.objectContaining({ component_parameter: 'load', model_parameter: 'load' }));
  });
});
