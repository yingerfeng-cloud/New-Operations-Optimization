import { Table } from 'antd';
import type { TableProps } from 'antd';
import { EmptyState } from '../EmptyState';

export function DataTable<T extends object>(props: TableProps<T>) {
  return (
    <div className="table-card">
      <Table
        rowKey={row => String((row as Record<string, unknown>).id || (row as Record<string, unknown>).component_id || (row as Record<string, unknown>).code)}
        scroll={{ x: 'max-content' }}
        pagination={props.pagination ?? { pageSize: 10, showSizeChanger: true }}
        locale={{ emptyText: <EmptyState /> }}
        size="middle"
        {...props}
      />
    </div>
  );
}
