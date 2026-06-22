import { parseFormulaDsl,splitRelation } from '../../features/formula-editor/formulaParser'; import { tokensToDsl } from '../../features/formula-editor/formulaDsl';
const symbols={sets:{unit:'机组集合'},parameters:{load:{label:'负荷',indices:['time']}},variables:{p:{label:'出力',indices:['unit','time']}}};
test('parses aggregate DSL',()=>{const tokens=parseFormulaDsl('sum(p[u,t] for u in unit)',symbols);expect(tokens[0].type).toBe('aggregate');expect(tokensToDsl(tokens)).toBe('sum(p[u,t] for u in unit)')});
test('splits top-level relation',()=>expect(splitRelation('sum(p[u,t] for u in unit) >= load[t]')?.sense).toBe('>='));
