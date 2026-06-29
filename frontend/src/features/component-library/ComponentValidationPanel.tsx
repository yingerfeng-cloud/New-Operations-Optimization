import { Alert } from 'antd';

export function ComponentValidationPanel({ result }: { result?: { valid: boolean; errors?: unknown[] } }) {
  return (
    <>
      <Alert
        showIcon
        type={result?.valid ? 'success' : 'warning'}
        title={result?.valid ? '组件校验通过' : '尚未通过组件校验'}
        description={result ? '校验结果来自后端组件校验接口' : '请先点击校验组件'}
      />
      {result?.errors?.length ? (
        <ul className="compact-list section-gap">
          {result.errors.map((item, index) => <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}
        </ul>
      ) : null}
    </>
  );
}
