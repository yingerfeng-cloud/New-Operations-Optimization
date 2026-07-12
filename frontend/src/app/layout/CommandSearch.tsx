import { Alert, Empty, Input, Modal, Spin, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getComponents } from '../../api/components';
import { getFunctionAssets } from '../../api/functionAssets';
import { getModels } from '../../api/models';
import { getResults } from '../../api/results';
import { getTasks } from '../../api/tasks';
import { scenarioCatalog } from '../../features/model-creation/data/scenarioCatalog';

type SearchKind = '模型' | '业务场景' | '组件' | '函数资产' | '任务' | '结果报告';
interface SearchItem { id: string; name: string; kind: SearchKind; status?: string; summary?: string; href: string }

const kinds: SearchKind[] = ['模型', '业务场景', '组件', '函数资产', '任务', '结果报告'];
const searchable = (item: SearchItem) => `${item.name} ${item.id} ${item.status || ''} ${item.summary || ''}`.toLocaleLowerCase();

export function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [failedKinds, setFailedKinds] = useState<SearchKind[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery(''); setDebounced(''); setActive(0); setFailedKinds([]); setItems([]); setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim().toLocaleLowerCase()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    const sources: Array<[SearchKind, Promise<unknown>]> = [
      ['模型', getModels()], ['组件', getComponents()], ['函数资产', getFunctionAssets()], ['任务', getTasks()], ['结果报告', getResults()],
    ];
    Promise.allSettled(sources.map(([, promise]) => promise)).then(results => {
      if (!live) return;
      const next: SearchItem[] = scenarioCatalog.map(scene => ({ id: scene.id, name: scene.name, kind: '业务场景', status: scene.status, summary: scene.description, href: `/scenarios?scene=${encodeURIComponent(scene.id)}` }));
      const failed: SearchKind[] = [];
      results.forEach((result, index) => {
        const kind = sources[index][0];
        if (result.status === 'rejected') { failed.push(kind); return; }
        const rows = Array.isArray(result.value) ? result.value as Array<Record<string, unknown>> : [];
        rows.forEach(row => {
          if (kind === '模型') next.push({ id: String(row.id), name: String(row.name || row.id), kind, status: String(row.status || ''), summary: String(row.scene || row.problem_type || ''), href: `/models/${row.id}` });
          if (kind === '组件') next.push({ id: String(row.component_id), name: String(row.display_name || row.name || row.component_id), kind, status: String(row.status || ''), summary: String(row.category || row.domain || ''), href: `/components/${row.component_id}` });
          if (kind === '函数资产') next.push({ id: String(row.function_id), name: String(row.name || row.function_id), kind, status: String(row.status || row.validation_status || ''), summary: String(row.description || row.function_type || ''), href: `/functions?asset=${encodeURIComponent(String(row.function_id))}` });
          if (kind === '任务') next.push({ id: String(row.id), name: String(row.name || row.id), kind, status: String(row.status || ''), summary: String(row.model || row.scene || ''), href: `/tasks?task=${encodeURIComponent(String(row.id))}` });
          if (kind === '结果报告') { const id = String(row.task_id || row.job_id || row.id); next.push({ id, name: String(row.name || `报告 ${id}`), kind, status: String(row.status || ''), summary: String(row.suggestion || ''), href: `/results?task=${encodeURIComponent(id)}` }); }
        });
      });
      setItems(next); setFailedKinds(failed); setLoading(false);
    });
    return () => { live = false; };
  }, [open]);

  const filtered = useMemo(() => debounced ? items.filter(item => searchable(item).includes(debounced)) : items.slice(0, 18), [debounced, items]);
  const displayed = useMemo(() => kinds.flatMap(kind => filtered.filter(item => item.kind === kind)), [filtered]);
  const grouped = useMemo(() => kinds.map(kind => ({ kind, items: displayed.filter(item => item.kind === kind) })).filter(group => group.items.length), [displayed]);
  useEffect(() => setActive(0), [debounced]);
  useEffect(() => { const node = resultsRef.current?.querySelector<HTMLElement>(`[data-search-index="${active}"]`); if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' }); }, [active]);

  const choose = (item: SearchItem) => { navigate(item.href); onClose(); };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(value => Math.min(displayed.length - 1, value + 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(0, value - 1)); }
    if (event.key === 'Enter' && displayed[active]) { event.preventDefault(); choose(displayed[active]); }
  };

  return (
    <Modal className="command-search-modal" title={null} footer={null} open={open} onCancel={onClose} width={720} destroyOnHidden>
      <div onKeyDown={onKeyDown}>
        <Input autoFocus size="large" prefix={<SearchOutlined />} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索模型、场景、组件、函数、任务或报告" aria-label="全局搜索" allowClear />
        <div className="command-search-hint"><span>↑↓ 选择 · Enter 打开 · Esc 关闭</span><span>{displayed.length} 项结果</span></div>
        {failedKinds.length > 0 && <Alert type="warning" showIcon message={`${failedKinds.join('、')}暂时不可搜索，其他结果仍可使用`} />}
        <div ref={resultsRef} className="command-search-results" role="listbox" aria-label="搜索结果">
          {loading ? <div className="command-search-loading"><Spin /><span>正在汇集平台资产…</span></div> : grouped.length ? grouped.map(group => (
            <section key={group.kind} className="command-search-group">
              <div className="command-search-group-title">{group.kind}</div>
              {group.items.map(item => {
                const index = displayed.indexOf(item);
                return <button data-search-index={index} key={`${item.kind}-${item.id}`} className={index === active ? 'active' : ''} onMouseEnter={() => setActive(index)} onClick={() => choose(item)} role="option" aria-selected={index === active}>
                  <span><strong>{item.name}</strong><small>{item.summary || item.id}</small></span>
                  {item.status && <Tag>{item.status}</Tag>}
                </button>;
              })}
            </section>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={debounced ? '没有匹配结果' : '暂无可搜索数据'} />}
        </div>
      </div>
    </Modal>
  );
}
