import { Alert, Button, Card, Descriptions, Drawer, Empty, Input, InputNumber, Modal, Select, Space, Steps, Tag, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getModelAssetDetail, getModelSchema } from '../../api/models';
import type { ModelAsset } from '../../types/model';
import { capabilityOrFallback } from '../demo/demoCapabilities';
import { deriveHorizon, isRuntimeValueEmpty, managedTimeFields, objectValue, resolveTimeDimension, runtimeFieldsFromContracts, stripSystemTimeParameters, timeDimensionLabel, validateRuntimeTimeDimension } from '../time-dimension';
import { ParameterEditor, type ParameterChangeSource } from './components/ParameterEditor';
import { RuntimeDataSummaryBar } from './components/RuntimeDataSummaryBar';
import { RuntimeParameterGroupNav } from './components/RuntimeParameterGroupNav';
import { RuntimeParameterFilters } from './components/RuntimeParameterFilters';
import { RuntimeValidationDrawer } from './components/RuntimeValidationDrawer';
import { HistoricalTaskParameterModal } from './components/HistoricalTaskParameterModal';
import { buildTaskPayload } from './utils/buildTaskPayload';
import { filterRuntimeFields, groupRuntimeFields, isRuntimeValueModified, runtimeFieldIssues, type RuntimeParameterFilter } from './utils/runtimeParameterGroups';
import { mergeHistoricalParameters, type HistoryApplyMode } from './utils/runtimeParameterHistory';
import type { SolveTask } from '../../types/task';

const defaultsFrom = (...sources: unknown[]) => Object.assign({}, ...sources.map(source => {
  const record = objectValue(source); const semantic = objectValue(record.semantic_spec); const draft = objectValue(record.model_draft);
  return { ...objectValue(semantic.sample_runtime_parameters), ...objectValue(draft.runtime_parameters), ...objectValue(record.parameters) };
}));

interface Props { open: boolean; models: ModelAsset[]; initialModelId?: string; initialScene?: string; submitting?: boolean; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<unknown> }

export function parseTaskRuntimeJson(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('运行参数 JSON 的根节点必须为对象，例如 {"load": [1,2,3]}。');
  return parsed as Record<string, unknown>;
}

const sourceLabels: Record<string, string> = { default: '模型默认', manual: '手工编辑', batch: '批量粘贴', history: '历史任务', json: 'JSON 导入', file: '文件导入', 'restore-default': '恢复默认' };

export function TaskCreateWizard({ open, models, initialModelId, initialScene, submitting = false, onClose, onSubmit }: Props) {
  const [modal, modalContextHolder] = Modal.useModal();
  const [step, setStep] = useState(0); const [modelId, setModelId] = useState(''); const [solver, setSolver] = useState('HiGHS'); const [horizon, setHorizon] = useState<number>();
  const [parameters, setParameters] = useState<Record<string, unknown>>({}); const [defaultValues, setDefaultValues] = useState<Record<string, unknown>>({});
  const [changeSources, setChangeSources] = useState<Record<string, string>>({}); const [activeGroup, setActiveGroup] = useState(''); const [filter, setFilter] = useState<RuntimeParameterFilter>('all');
  const [advancedOpen, setAdvancedOpen] = useState(false); const [jsonText, setJsonText] = useState(''); const [dirty, setDirty] = useState(false);
  const [initializedModelId, setInitializedModelId] = useState(''); const [editorErrors, setEditorErrors] = useState<Record<string, string>>({}); const [submitError, setSubmitError] = useState('');
  const [submitLocked, setSubmitLocked] = useState(false); const [issuesOpen, setIssuesOpen] = useState(false); const [historyOpen, setHistoryOpen] = useState(false); const [highlightCode, setHighlightCode] = useState('');
  const issueNavigationTimerRef = useRef<number | undefined>(undefined); const issueHighlightTimerRef = useRef<number | undefined>(undefined);
  const selected = models.find(model => model.id === modelId);
  const schema = useQuery({ queryKey: ['model-schema', modelId], queryFn: () => getModelSchema(modelId), enabled: open && !!modelId, retry: false });
  const detail = useQuery({ queryKey: ['model-asset-detail', modelId], queryFn: () => getModelAssetDetail(modelId), enabled: open && !!modelId, retry: false });
  const contractLoading = Boolean(modelId && (schema.isPending || detail.isPending || schema.isFetching || detail.isFetching));
  const schemaUsable = schema.isSuccess && Boolean(schema.data); const detailUsable = detail.isSuccess && Boolean(detail.data); const contractUsable = schemaUsable || detailUsable;
  const contractFailed = Boolean(modelId && !contractLoading && !contractUsable); const contractPartial = Boolean(modelId && !contractLoading && contractUsable && (!schemaUsable || !detailUsable));
  const fields = useMemo(() => contractUsable ? runtimeFieldsFromContracts(schema.data, detail.data) : [], [contractUsable, schema.data, detail.data]);
  const config = useMemo(() => contractUsable ? resolveTimeDimension(detail.data, schema.data, selected) : resolveTimeDimension(), [contractUsable, detail.data, schema.data, selected]);
  const visibleFields = useMemo(() => fields.filter(field => !managedTimeFields(config).has(field.code)), [config, fields]);
  const groups = useMemo(() => groupRuntimeFields(visibleFields, config), [config, visibleFields]);
  const capability = capabilityOrFallback(selected || {}); const effectiveHorizon = deriveHorizon(config, fields, parameters, horizon);
  const timeErrors = useMemo(() => contractUsable ? validateRuntimeTimeDimension(config, fields, parameters, horizon) : [], [config, contractUsable, fields, horizon, parameters]);
  const requiredErrors = useMemo(() => Object.fromEntries(visibleFields.filter(field => field.required && isRuntimeValueEmpty(parameters[field.code])).map(field => [field.code, '必填值为空'])), [parameters, visibleFields]);
  const fieldErrors = useMemo(() => ({ ...requiredErrors, ...Object.fromEntries(Object.entries(editorErrors).filter(([, error]) => error)) }), [editorErrors, requiredErrors]);
  const issues = useMemo(() => runtimeFieldIssues(groups, parameters, editorErrors, timeErrors), [editorErrors, groups, parameters, timeErrors]);
  const validationErrors = useMemo(() => {
    const result: string[] = [];
    if (contractLoading) result.push('模型运行参数契约正在加载，请稍候。');
    if (contractFailed) result.push('模型运行参数契约加载失败，当前无法确认输入参数和时间维度。请重新加载后再提交任务。');
    issues.forEach(issue => result.push(`${issue.name}（${issue.code}）：${issue.message}`));
    timeErrors.filter(error => !issues.some(issue => issue.message === error)).forEach(error => result.push(error));
    return [...new Set(result)];
  }, [contractFailed, contractLoading, issues, timeErrors]);
  const currentGroup = groups.find(group => group.key === activeGroup) || groups[0];
  const displayedFields = useMemo(() => {
    const filtered = filterRuntimeFields(currentGroup?.fields || [], filter, parameters, defaultValues, fieldErrors);
    return [...filtered].sort((a, b) => Number(Boolean(fieldErrors[b.code])) - Number(Boolean(fieldErrors[a.code])));
  }, [currentGroup, defaultValues, fieldErrors, filter, parameters]);
  const requiredFields = visibleFields.filter(field => field.required); const requiredDone = requiredFields.filter(field => !isRuntimeValueEmpty(parameters[field.code])).length;
  const modifiedCount = visibleFields.filter(field => isRuntimeValueModified(parameters[field.code], defaultValues[field.code])).length;

  const reset = () => {
    setStep(0); setModelId(''); setSolver('HiGHS'); setHorizon(undefined); setParameters({}); setDefaultValues({}); setChangeSources({}); setActiveGroup(''); setFilter('all');
    setAdvancedOpen(false); setJsonText(''); setDirty(false); setInitializedModelId(''); setEditorErrors({}); setSubmitError(''); setSubmitLocked(false); setIssuesOpen(false); setHistoryOpen(false); setHighlightCode('');
  };
  useEffect(() => { if (!open) reset(); }, [open]);
  useEffect(() => { if (open && initialModelId && !modelId) setModelId(initialModelId); }, [initialModelId, modelId, open]);
  useEffect(() => { if (groups.length && !groups.some(group => group.key === activeGroup)) setActiveGroup(groups[0].key); }, [activeGroup, groups]);
  useEffect(() => {
    if (!open || !modelId || !contractUsable || contractLoading || initializedModelId === modelId) return;
    const defaults = defaultsFrom(selected, detail.data, schema.data);
    const next = Object.fromEntries(visibleFields.map(field => [field.code, defaults[field.code] ?? field.defaultValue ?? field.exampleValue]).filter(([, value]) => value !== undefined));
    const clean = stripSystemTimeParameters(next, config); setParameters(clean); setDefaultValues(clean); setChangeSources(Object.fromEntries(Object.keys(clean).map(code => [code, 'default'])));
    setHorizon(config.default_horizon); setSolver(capability.problemType === 'NLP' ? 'Ipopt' : 'HiGHS'); setInitializedModelId(modelId); setDirty(false);
  }, [capability.problemType, config, contractLoading, contractUsable, detail.data, initializedModelId, modelId, open, schema.data, selected, visibleFields]);
  useEffect(() => { if (!submitting) setSubmitLocked(false); }, [submitting]);
  useEffect(() => () => {
    if (issueNavigationTimerRef.current !== undefined) window.clearTimeout(issueNavigationTimerRef.current);
    if (issueHighlightTimerRef.current !== undefined) window.clearTimeout(issueHighlightTimerRef.current);
  }, []);

  const applyModel = (nextId: string) => { setModelId(nextId); setStep(0); setParameters({}); setDefaultValues({}); setChangeSources({}); setHorizon(undefined); setSolver('HiGHS'); setJsonText(''); setAdvancedOpen(false); setEditorErrors({}); setSubmitError(''); setInitializedModelId(''); setDirty(false); setActiveGroup(''); setFilter('all'); };
  const selectModel = (nextId: string) => { if (!dirty || !modelId || nextId === modelId) return applyModel(nextId); modal.confirm({ title: '切换模型将清空当前已填写参数，是否继续？', okText: '继续切换', cancelText: '取消', onOk: () => applyModel(nextId) }); };
  const update = (code: string, value: unknown, source: ParameterChangeSource = 'manual') => { setDirty(true); setSubmitError(''); setParameters(current => ({ ...current, [code]: value })); setChangeSources(current => ({ ...current, [code]: source })); };
  const importJson = () => { try { const parsed = stripSystemTimeParameters(parseTaskRuntimeJson(jsonText), config); setParameters(current => ({ ...current, ...parsed })); setChangeSources(current => ({ ...current, ...Object.fromEntries(Object.keys(parsed).map(code => [code, 'json'])) })); setDirty(true); setSubmitError(''); message.success('参数已导入，系统时间字段已自动忽略'); } catch (error) { message.error(`导入失败：${String(error)}`); } };
  const navigateIssue = (issue: typeof issues[number]) => {
    setIssuesOpen(false); setActiveGroup(issue.groupKey); setFilter('all'); setHighlightCode(issue.code);
    if (issueNavigationTimerRef.current !== undefined) window.clearTimeout(issueNavigationTimerRef.current);
    if (issueHighlightTimerRef.current !== undefined) window.clearTimeout(issueHighlightTimerRef.current);
    issueNavigationTimerRef.current = window.setTimeout(() => { issueNavigationTimerRef.current = undefined; const node = document.getElementById(`runtime-field-${issue.code}`); node?.scrollIntoView({ behavior: 'smooth', block: 'center' }); (node?.querySelector('input, textarea, button') as HTMLElement | null)?.focus(); issueHighlightTimerRef.current = window.setTimeout(() => { issueHighlightTimerRef.current = undefined; setHighlightCode(''); }, 1800); }, 100);
  };
  const applyHistory = (task: SolveTask, incoming: Record<string, unknown>, mode: HistoryApplyMode) => {
    const result = mergeHistoricalParameters({ current: parameters, incoming, fields: visibleFields, config, mode });
    setParameters(result.parameters); setChangeSources(current => ({ ...current, ...Object.fromEntries(result.applied.map(code => [code, 'history'])) })); setDirty(result.applied.length > 0 || dirty); setHistoryOpen(false);
    message.success(`已从任务 ${task.id} 载入 ${result.applied.length} 个参数${result.unknown.length ? `，忽略 ${result.unknown.length} 个未知参数` : ''}`);
  };
  const next = () => { if (step === 0 && !modelId) return message.warning('请先选择模型'); if (step === 0 && contractLoading) return message.warning('模型契约仍在加载'); if (step === 0 && contractFailed) return message.warning('模型契约加载失败，请重试'); if (step === 1 && validationErrors.length) return message.warning('请先修正参数问题'); setStep(value => Math.min(2, value + 1)); };
  const submit = async () => { if (submitting || submitLocked || validationErrors.length || !contractUsable) return; setSubmitLocked(true); setSubmitError(''); try { const payload = buildTaskPayload({ model_id: modelId, solver, horizon, parameters }, config); if (initialScene) payload.scene = initialScene; await onSubmit(payload); reset(); onClose(); } catch (error) { setSubmitError(`提交失败：${String(error)}`); setSubmitLocked(false); } };
  const close = () => { if (!submitting) { reset(); onClose(); } }; const retryContract = () => { schema.refetch(); detail.refetch(); };
  const intervalMinutes = effectiveHorizon ? config.interval_minutes_by_horizon[String(effectiveHorizon)] || config.interval_minutes : config.interval_minutes;

  return <Drawer className="task-create-drawer" title="创建求解任务" open={open} destroyOnHidden size="large" maskClosable={!submitting} closable={!submitting} onClose={close} footer={<div className="wizard-footer"><Button disabled={submitting} onClick={close}>取消</Button><span className="wizard-footer-spacer" />{step > 0 && <Button disabled={submitting} onClick={() => setStep(value => value - 1)}>上一步</Button>}{step < 2 ? <Button type="primary" disabled={contractLoading || contractFailed} onClick={next}>下一步</Button> : <Button type="primary" loading={submitting || submitLocked} disabled={validationErrors.length > 0 || !contractUsable || submitting || submitLocked} title={validationErrors.length ? '请先修正参数问题' : undefined} onClick={submit}>提交求解并打开详情</Button>}</div>}>
    {modalContextHolder}<Steps current={step} size="small" items={[{ title: '选择模型' }, { title: '填写运行数据' }, { title: '检查并提交' }]} />
    {step === 0 && <div className="wizard-step"><Card title="选择可调用模型"><Select aria-label="选择模型" showSearch optionFilterProp="label" value={modelId || undefined} onChange={selectModel} placeholder="按名称选择已发布模型" style={{ width: '100%' }} options={models.filter(model => ['published', 'active', 'online', 'ready'].includes(String(model.status).toLowerCase()) || !model.status).map(model => ({ value: model.id, label: `${model.name} · ${model.version || '当前版本'}` }))} />{selected && <Descriptions className="section-gap" size="small" column={1} bordered items={[{ key: 'scene', label: '适用场景', children: selected.scene || '-' }, { key: 'problem', label: '问题类型', children: capability.problemType || selected.problem_type || '-' }, { key: 'time', label: '时间维度', children: contractUsable ? timeDimensionLabel(config, horizon) : contractLoading ? '正在读取契约' : '契约不可用' }, { key: 'solver', label: '默认求解器', children: capability.problemType === 'NLP' ? 'Ipopt' : 'HiGHS' }]} />}{contractFailed && <Alert className="section-gap" showIcon type="error" title="模型运行参数契约加载失败" description="当前无法确认输入参数和时间维度，请重新加载后再继续。" action={<Button onClick={retryContract}>重新加载契约</Button>} />}{contractPartial && <Alert className="section-gap" showIcon type="warning" title="部分契约接口不可用" description={`当前使用${detailUsable ? '模型详情' : '模型 Schema'}作为兼容契约来源，可继续创建任务。`} />}</Card></div>}
    {step === 1 && <div className="wizard-step runtime-data-workspace">
      <RuntimeDataSummaryBar modelName={selected?.name || modelId} timeLabel={timeDimensionLabel(config, effectiveHorizon)} horizon={effectiveHorizon} intervalMinutes={intervalMinutes} requiredDone={requiredDone} requiredTotal={requiredFields.length} errorCount={validationErrors.length} modifiedCount={modifiedCount} onIssues={() => setIssuesOpen(true)} />
      <section className="runtime-setup-strip">
        <div>{config.policy === 'not_applicable' && <span>非时序模型</span>}{config.policy === 'fixed' && <span>固定调度周期：{config.default_horizon ?? '-'} 点</span>}{config.policy === 'data_derived' && <span>{effectiveHorizon ? `已从 ${config.derive_from || '主时间序列'} 推导 ${effectiveHorizon} 点` : `由 ${config.derive_from || '主时间序列'} 自动推导 horizon`}</span>}{config.policy === 'runtime_variable' && <><label>调度周期</label>{config.allowed_horizons.length ? <Select aria-label="调度周期" value={horizon} onChange={value => { setHorizon(value); setDirty(true); }} options={config.allowed_horizons.map(value => ({ value, label: `${value} 点${config.interval_minutes_by_horizon[String(value)] ? ` · ${config.interval_minutes_by_horizon[String(value)]} 分钟` : ''}` }))} /> : <InputNumber aria-label="调度周期" value={horizon} min={config.min_horizon || 1} max={config.max_horizon} step={config.horizon_step || 1} onChange={value => { setHorizon(value ?? undefined); setDirty(true); }} />}</>}</div>
        <div><label>求解器</label><Select aria-label="求解器" value={solver} onChange={value => { setSolver(value); setDirty(true); }} options={capability.problemType === 'NLP' ? [{ value: 'Ipopt', label: 'Ipopt' }] : [{ value: 'HiGHS', label: 'HiGHS' }]} /></div>
        <Button onClick={() => setHistoryOpen(true)}>从历史任务载入</Button>
      </section>
      {timeErrors.filter(error => !issues.some(issue => issue.message === error)).map(error => <Alert className="runtime-time-error" key={error} type="warning" showIcon title={error} />)}
      {groups.length > 0 && <><RuntimeParameterGroupNav groups={groups} activeKey={currentGroup?.key || ''} values={parameters} errors={fieldErrors} defaults={defaultValues} onChange={key => { setActiveGroup(key); setFilter('all'); }} /><RuntimeParameterFilters value={filter} onChange={setFilter} /></>}
      <section className="runtime-parameter-group"><header><div><h3>{currentGroup?.label || '业务参数'}</h3><p>{currentGroup?.description || '仅渲染当前参数组，切换分组不会丢失已填写内容。'}</p></div><span>{displayedFields.length}/{currentGroup?.fields.length || 0} 字段</span></header>
        <div className="parameter-field-list">{displayedFields.map(field => { const fieldError = fieldErrors[field.code] || (config.policy === 'data_derived' && field.code === config.derive_from ? timeErrors[0] : ''); const modified = isRuntimeValueModified(parameters[field.code], defaultValues[field.code]); return <div id={`runtime-field-${field.code}`} className={`parameter-field${fieldError ? ' parameter-field-error' : ''}${highlightCode === field.code ? ' parameter-field-highlight' : ''}`} key={field.code}>
          <div className="parameter-field-label"><strong>{field.name}</strong>{field.required && <span className="field-required">必填</span>}<code>{field.code}</code>{field.unit && <span>{field.unit}</span>}{modified && <Tag>已修改</Tag>}<small>{sourceLabels[changeSources[field.code] || 'default']}</small></div>
          {(field.helpText || field.description) && <p>{field.helpText || field.description}</p>}
          <ParameterEditor field={field} value={parameters[field.code]} originalValue={defaultValues[field.code]} onChange={(value, source) => update(field.code, value, source)} onValidityChange={error => setEditorErrors(current => ({ ...current, [field.code]: error || '' }))} expectedLength={field.dimension.includes(config.state_time_set || '__none__') ? effectiveHorizon ? effectiveHorizon + 1 : undefined : field.dimension.includes(config.time_set) ? effectiveHorizon : undefined} timeSet={config.time_set} stateTimeSet={config.state_time_set} intervalMinutes={intervalMinutes} labelFormat={config.label_format} />
          {fieldError && <div className="parameter-inline-error">{fieldError}</div>}{field.dataSourceLabel && <div className="parameter-data-source">数据来源：{field.dataSourceLabel}</div>}
        </div>; })}</div>
        {!displayedFields.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span>当前筛选下没有字段 <Button type="link" onClick={() => setFilter('all')}>恢复“全部”</Button></span>} />}
      </section>
      <section className="runtime-advanced-input"><Button type="text" onClick={() => setAdvancedOpen(value => !value)}>{advancedOpen ? '收起高级 JSON 输入' : '展开高级 JSON 输入'}</Button>{advancedOpen && <div className="section-gap-tight"><Input.TextArea aria-label="高级参数 JSON" rows={5} value={jsonText} onChange={event => setJsonText(event.target.value)} placeholder='{"load_forecast":[100,120]}' /><Button className="section-gap-tight" onClick={importJson}>导入并合并</Button></div>}</section>
    </div>}
    {step === 2 && <div className="wizard-step"><Alert showIcon type={validationErrors.length ? 'warning' : 'success'} title={validationErrors.length ? `发现 ${validationErrors.length} 个待修正问题` : '参数检查通过，可以提交求解'} description={validationErrors.length ? validationErrors.join('；') : '系统时间字段将由模型契约管理，提交结构保持与现有接口兼容。'} />{submitError && <Alert className="section-gap" showIcon type="error" title={submitError} />}<Descriptions className="section-gap" bordered size="small" column={1} items={[{ key: 'model', label: '模型', children: selected?.name || modelId }, { key: 'time', label: '调度周期', children: timeDimensionLabel(config, effectiveHorizon) }, { key: 'solver', label: '求解器', children: solver }, { key: 'params', label: '业务参数', children: `${Object.keys(parameters).length} 项` }]} /><Card className="section-gap" size="small" title="提交内容预览"><pre className="payload-preview">{JSON.stringify(buildTaskPayload({ model_id: modelId, solver, horizon, parameters }, config), null, 2)}</pre></Card></div>}
    {issuesOpen && <RuntimeValidationDrawer open issues={issues} onClose={() => setIssuesOpen(false)} onNavigate={navigateIssue} />}
    {historyOpen && <HistoricalTaskParameterModal open modelId={modelId} modelFamily={String(selected?.model_family || selected?.template_id || '') || undefined} currentHorizon={effectiveHorizon} onCancel={() => setHistoryOpen(false)} onApply={applyHistory} />}
  </Drawer>;
}
