import { Tag } from 'antd';

const statusMap: Record<string, { color: string; label: string }> = {
  SUCCESS: { color: 'green', label: '成功' },
  RUNNING: { color: 'blue', label: '运行中' },
  QUEUED: { color: 'gold', label: '排队' },
  VALIDATING: { color: 'blue', label: '参数校验' },
  BUILDING_MODEL: { color: 'blue', label: '建模中' },
  SOLVING: { color: 'blue', label: '求解中' },
  FORMATTING_RESULT: { color: 'blue', label: '结果解析' },
  PENDING: { color: 'gold', label: '排队' },
  FAILED: { color: 'red', label: '失败' },
  INFEASIBLE: { color: 'red', label: '无解' },
  TIMEOUT: { color: 'red', label: '超时' },
  CANCELLED: { color: 'gold', label: '已取消' },
  published: { color: 'green', label: '已发布' },
  trial: { color: 'blue', label: '试运行' },
  tested: { color: 'green', label: '已测试' },
  developing: { color: 'gold', label: '开发中' },
  offline: { color: 'default', label: '已下线' },
  valid: { color: 'green', label: '有效' },
  invalid: { color: 'red', label: '无效' },
};

export function StatusTag({ status }: { status?: string }) {
  const raw = status || 'unknown';
  const preset = statusMap[raw] || statusMap[String(raw).toUpperCase()];
  const color = preset?.color || (/success|published|valid/i.test(raw) ? 'green' : /fail|error|offline|cancel/i.test(raw) ? 'red' : /running|solving|test|trial/i.test(raw) ? 'blue' : 'gold');
  return (
    <Tag className={`status-pill status-pill-${color}`} color={color} title={raw}>
      {preset?.label || raw}
      {preset?.label && preset.label !== raw ? <span className="sr-only">{raw}</span> : null}
    </Tag>
  );
}
