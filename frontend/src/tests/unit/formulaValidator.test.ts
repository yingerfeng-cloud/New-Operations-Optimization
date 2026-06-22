import { validateFormula } from '../../features/formula-editor/formulaValidator';
test('accepts linear aggregate constraint',()=>expect(validateFormula('sum(p[u,t] for u in unit) >= load[t]','constraint').valid).toBe(true));
test('rejects unsupported relation',()=>expect(validateFormula('p[t] != load[t]','constraint').valid).toBe(false));
