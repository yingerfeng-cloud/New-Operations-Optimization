import { parseFormulaDsl,splitRelation } from '../../features/formula-editor/formulaParser'; import { tokensToDsl } from '../../features/formula-editor/formulaDsl';
const symbols={sets:{unit:'机组集合'},parameters:{load:{label:'负荷',indices:['time']}},variables:{p:{label:'出力',indices:['unit','time']}}};
test('parses aggregate DSL',()=>{const tokens=parseFormulaDsl('sum(p[u,t] for u in unit)',symbols);expect(tokens[0].type).toBe('aggregate');expect(tokensToDsl(tokens)).toBe('sum(p[u,t] for u in unit)')});
test('parses nested functions without treating function names as parameters',()=>{const tokens=parseFormulaDsl('abs(sum(p[u,t] for u in unit))',symbols);expect(tokens[0]).toMatchObject({type:'function',fn:'abs'});expect(tokensToDsl(tokens)).toBe('abs(sum(p[u,t] for u in unit))')});
test('parses function calls embedded in a relation',()=>{const tokens=parseFormulaDsl('abs(p[u,t]) <= load[t]',symbols);expect(tokens[0]).toMatchObject({type:'function',fn:'abs'});expect(tokensToDsl(tokens)).toBe('abs(p[u,t]) <= load[t]')});
test('splits top-level relation',()=>expect(splitRelation('sum(p[u,t] for u in unit) >= load[t]')?.sense).toBe('>='));
