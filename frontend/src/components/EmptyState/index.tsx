import { Empty } from 'antd';

export function EmptyState({ description = '暂无数据' }: { description?: string }) {
  return (
    <div className="empty-state">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />
    </div>
  );
}
