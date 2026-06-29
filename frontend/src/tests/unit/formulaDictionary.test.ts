import { dictionaryToSymbols, getFormulaSymbolDictionary } from '../../features/formula-editor/formulaDictionary';

test('builds dictionary from semantic model and components with Chinese metadata', () => {
  const dictionary = getFormulaSymbolDictionary({
    semantic: {
      sets: [{ code: 'time', name: '调度时段', description: '逐时调度' }],
      parameters: [{ code: 'load', name: '负荷预测', indices: ['time'], unit: 'MW', description: '日前负荷' }],
      variables: [{ code: 'p', name: '机组出力', indices: ['unit', 'time'], unit: 'MW' }],
    },
    components: [{
      required_sets: [{ code: 'unit', name: '机组集合' }],
      parameters: [{ code: 'pmax', name: '最大出力', dimension: ['unit'], unit: 'MW' }],
      variables: [{ code: 'on', name: '启停状态', dimension: ['unit', 'time'] }],
    }],
  });

  expect(dictionary.find(item => item.code === 'load')?.name).toBe('负荷预测');
  expect(dictionary.find(item => item.code === 'pmax')?.indices).toEqual(['unit']);
  expect(dictionary.find(item => item.code === 'M')?.name).toBe('Big-M 常数');

  const symbols = dictionaryToSymbols(dictionary);
  expect(symbols.variables?.p.label).toBe('机组出力');
  expect(symbols.sets?.unit).toBe('机组集合');
});
