import { Alert } from 'antd';
import type { FormulaValidation } from './formulaValidator';

export function FormulaValidationPanel({ result }: { result: FormulaValidation }) {
  const items = [...result.errors, ...result.warnings];
  return (
    <Alert
      type={result.valid ? 'success' : 'error'}
      showIcon
      title={result.valid ? '公式校验通过' : '公式校验失败'}
      description={items.length ? <ul className="compact-list">{items.map(item => <li key={item}>{item}</li>)}</ul> : '无错误'}
    />
  );
}
