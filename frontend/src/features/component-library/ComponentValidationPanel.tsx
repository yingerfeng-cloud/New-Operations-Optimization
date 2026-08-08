import { Alert } from 'antd';

export function ComponentValidationPanel({ result }: { result?: { valid: boolean; execution_ready?: boolean; errors?: unknown[] } }) {
  const executionReady = Boolean(result?.valid && result.execution_ready !== false);
  return (
    <>
      <Alert
        showIcon
        type={executionReady ? 'success' : 'warning'}
        title={executionReady ? '执行校验通过' : result?.valid ? '组件仅可作为元数据保存' : '尚未通过执行校验'}
        description={result ? (executionReady ? '约束或目标公式已通过后端编译检查，可以发布。' : '当前组件不能发布为可求解组件。') : '请先点击校验组件'}
      />
      {result?.errors?.length ? (
        <ul className="compact-list section-gap">
          {result.errors.map((item, index) => <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}
        </ul>
      ) : null}
    </>
  );
}
