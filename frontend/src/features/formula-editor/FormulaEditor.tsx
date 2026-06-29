import type { FormulaDef } from '../../types/formula';
import type { FormulaSymbols } from './formulaParser';
import { FormulaBuilder } from './FormulaBuilderModal';

export function FormulaEditor({
  value,
  onChange,
  onApply,
  onCancel,
  onDelete,
  symbols = {},
}: {
  value?: FormulaDef;
  onChange?: (formula: FormulaDef) => void;
  onApply?: (formula: FormulaDef) => void;
  onCancel?: () => void;
  onDelete?: (formulaId: string) => void;
  symbols?: FormulaSymbols;
}) {
  return (
    <FormulaBuilder
      value={value}
      symbols={symbols}
      onApply={formula => {
        onApply?.(formula);
        onChange?.(formula);
      }}
      onCancel={onCancel}
      onDelete={onDelete}
    />
  );
}
