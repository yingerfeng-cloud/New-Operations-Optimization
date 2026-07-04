import { Table } from 'antd';
import type { TableProps } from 'antd';
import { EmptyState } from '../EmptyState';

const objectRowKeys = new WeakMap<object, string>();
let objectRowKeySeed = 0;

function defaultRowKey<T extends object>(row: T) {
  const record = row as Record<string, unknown>;
  const stableId = record.id || record.component_id || record.function_id || record.task_id || record.job_id || record.model_id || record.template_id || record.service_id;
  if (stableId) return String(stableId);
  const existing = objectRowKeys.get(row);
  if (existing) return existing;
  objectRowKeySeed += 1;
  const generated = `row-${objectRowKeySeed}`;
  objectRowKeys.set(row, generated);
  return generated;
}

export function DataTable<T extends object>(props: TableProps<T>) {
  return (
    <div className="table-card">
      <Table
        rowKey={defaultRowKey}
        scroll={props.scroll}
        pagination={props.pagination ?? { pageSize: 10, showSizeChanger: true }}
        locale={{ emptyText: <EmptyState /> }}
        size="middle"
        {...props}
      />
    </div>
  );
}
