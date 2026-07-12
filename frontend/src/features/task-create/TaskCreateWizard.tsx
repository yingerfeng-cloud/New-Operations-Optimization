import { Alert, Button, Card, Descriptions, Drawer, Input, InputNumber, Modal, Select, Space, Steps, Tag, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getModelAssetDetail, getModelSchema } from '../../api/models';
import type { ModelAsset } from '../../types/model';
import { capabilityOrFallback } from '../demo/demoCapabilities';
import { deriveHorizon, isRuntimeValueEmpty, managedTimeFields, objectValue, resolveTimeDimension, runtimeFieldsFromContracts, stripSystemTimeParameters, timeDimensionLabel, validateRuntimeTimeDimension } from '../time-dimension';
import { ParameterEditor } from './components/ParameterEditor';
import { buildTaskPayload } from './utils/buildTaskPayload';

const defaultsFrom = (...sources: unknown[]) => Object.assign({}, ...sources.map(source => {
  const record = objectValue(source); const semantic = objectValue(record.semantic_spec); const draft = objectValue(record.model_draft);
  return { ...objectValue(semantic.sample_runtime_parameters), ...objectValue(draft.runtime_parameters), ...objectValue(record.parameters) };
}));

interface Props { open: boolean; models: ModelAsset[]; submitting?: boolean; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => Promise<unknown> }

export function TaskCreateWizard({ open, models, submitting = false, onClose, onSubmit }: Props) {
  const [step, setStep] = useState(0);
  const [modelId, setModelId] = useState('');
  const [solver, setSolver] = useState('HiGHS');
  const [horizon, setHorizon] = useState<number>();
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [initializedModelId, setInitializedModelId] = useState('');
  const [editorErrors, setEditorErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [submitLocked, setSubmitLocked] = useState(false);
  const selected = models.find(model => model.id === modelId);
  const schema = useQuery({ queryKey: ['model-schema', modelId], queryFn: () => getModelSchema(modelId), enabled: open && !!modelId, retry: false });
  const detail = useQuery({ queryKey: ['model-asset-detail', modelId], queryFn: () => getModelAssetDetail(modelId), enabled: open && !!modelId, retry: false });
  const contractLoading = Boolean(modelId && (schema.isPending || detail.isPending || schema.isFetching || detail.isFetching));
  const schemaUsable = schema.isSuccess && Boolean(schema.data);
  const detailUsable = detail.isSuccess && Boolean(detail.data);
  const contractUsable = schemaUsable || detailUsable;
  const contractFailed = Boolean(modelId && !contractLoading && !contractUsable);
  const contractPartial = Boolean(modelId && !contractLoading && contractUsable && (!schemaUsable || !detailUsable));
  const fields = useMemo(() => contractUsable ? runtimeFieldsFromContracts(schema.data, detail.data) : [], [contractUsable, schema.data, detail.data]);
  const config = useMemo(() => contractUsable ? resolveTimeDimension(detail.data, schema.data, selected) : resolveTimeDimension(), [contractUsable, detail.data, schema.data, selected]);
  const visibleFields = useMemo(() => fields.filter(field => !managedTimeFields(config).has(field.code)), [config, fields]);
  const capability = capabilityOrFallback(selected || {});
  const effectiveHorizon = deriveHorizon(config, fields, parameters, horizon);
  const validationErrors = useMemo(() => {
    const result: string[] = [];
    if (contractLoading) result.push('模型运行参数契约正在加载，请稍候。');
    if (contractFailed) result.push('模型运行参数契约加载失败，当前无法确认输入参数和时间维度。请重新加载后再提交任务。');
    visibleFields.filter(field => field.required && isRuntimeValueEmpty(parameters[field.code])).forEach(field => result.push(`${field.name}（${field.code}）为必填项，当前值为空。`));
    result.push(...Object.entries(editorErrors).filter(([, error]) => error).map(([code, error]) => `${code}：${error}`));
    if (contractUsable) result.push(...validateRuntimeTimeDimension(config, fields, parameters, horizon));
    return [...new Set(result)];
  }, [config, contractFailed, contractLoading, contractUsable, editorErrors, fields, horizon, parameters, visibleFields]);

  const reset = () => {
    setStep(0); setModelId(''); setSolver('HiGHS'); setHorizon(undefined); setParameters({}); setAdvancedOpen(false); setJsonText('');
    setDirty(false); setInitializedModelId(''); setEditorErrors({}); setSubmitError(''); setSubmitLocked(false);
  };
  useEffect(() => { if (!open) reset(); }, [open]);
  useEffect(() => {
    if (!open || !modelId || !contractUsable || contractLoading || initializedModelId === modelId) return;
    const defaults = defaultsFrom(selected, detail.data, schema.data);
    const next = Object.fromEntries(visibleFields.map(field => [field.code, defaults[field.code] ?? field.defaultValue ?? field.exampleValue]).filter(([, value]) => value !== undefined));
    setParameters(stripSystemTimeParameters(next, config));
    setHorizon(config.default_horizon);
    setSolver(capability.problemType === 'NLP' ? 'Ipopt' : 'HiGHS');
    setInitializedModelId(modelId);
    setDirty(false);
  }, [capability.problemType, config, contractLoading, contractUsable, detail.data, initializedModelId, modelId, open, schema.data, selected, visibleFields]);
  useEffect(() => { if (!submitting) setSubmitLocked(false); }, [submitting]);

  const applyModel = (nextId: string) => {
    setModelId(nextId); setStep(0); setParameters({}); setHorizon(undefined); setSolver('HiGHS'); setJsonText(''); setAdvancedOpen(false);
    setEditorErrors({}); setSubmitError(''); setInitializedModelId(''); setDirty(false);
  };
  const selectModel = (nextId: string) => {
    if (!dirty || !modelId || nextId === modelId) return applyModel(nextId);
    Modal.confirm({ title: '切换模型将清空当前已填写参数，是否继续？', okText: '继续切换', cancelText: '取消', onOk: () => applyModel(nextId) });
  };
  const update = (code: string, value: unknown) => { setDirty(true); setSubmitError(''); setParameters(current => ({ ...current, [code]: value })); };
  const importJson = () => {
    try {
      const parsed = JSON.parse(jsonText || '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON 必须为对象');
      setParameters(current => ({ ...current, ...stripSystemTimeParameters(parsed as Record<string, unknown>, config) }));
      setDirty(true); setSubmitError(''); message.success('参数已导入，系统时间字段已自动忽略');
    } catch (error) { message.error(`导入失败：${String(error)}`); }
  };
  const next = () => {
    if (step === 0 && !modelId) return message.warning('请先选择模型');
    if (step === 0 && contractLoading) return message.warning('模型契约仍在加载');
    if (step === 0 && contractFailed) return message.warning('模型契约加载失败，请重试');
    if (step === 1 && validationErrors.length) return message.warning('请先修正参数问题');
    setStep(value => Math.min(2, value + 1));
  };
  const submit = async () => {
    if (submitting || submitLocked || validationErrors.length || !contractUsable) return;
    setSubmitLocked(true); setSubmitError('');
    try {
      await onSubmit(buildTaskPayload({ model_id: modelId, solver, horizon, parameters }, config));
      reset();
      onClose();
    }
    catch (error) { setSubmitError(`提交失败：${String(error)}`); setSubmitLocked(false); }
  };
  const close = () => { if (!submitting) { reset(); onClose(); } };
  const retryContract = () => { schema.refetch(); detail.refetch(); };

  return <Drawer className="task-create-drawer" title="创建求解任务" open={open} destroyOnHidden size="large" maskClosable={!submitting} closable={!submitting} onClose={close} footer={<div className="wizard-footer"><Button disabled={submitting} onClick={close}>取消</Button><span className="wizard-footer-spacer" />{step > 0 && <Button disabled={submitting} onClick={() => setStep(value => value - 1)}>上一步</Button>}{step < 2 ? <Button type="primary" disabled={contractLoading || contractFailed} onClick={next}>下一步</Button> : <Button type="primary" loading={submitting || submitLocked} disabled={validationErrors.length > 0 || !contractUsable || submitting || submitLocked} title={validationErrors.length ? '请先修正参数问题' : undefined} onClick={submit}>提交求解并打开详情</Button>}</div>}>
    <Steps current={step} size="small" items={[{ title: '选择模型' }, { title: '填写运行数据' }, { title: '检查并提交' }]} />
    {step === 0 && <div className="wizard-step"><Card title="选择可调用模型"><Select aria-label="选择模型" showSearch optionFilterProp="label" value={modelId || undefined} onChange={selectModel} placeholder="按名称选择已发布模型" style={{ width: '100%' }} options={models.filter(model => ['published', 'active', 'online', 'ready'].includes(String(model.status).toLowerCase()) || !model.status).map(model => ({ value: model.id, label: `${model.name} · ${model.version || '当前版本'}` }))} />{selected && <Descriptions className="section-gap" size="small" column={1} bordered items={[{ key: 'scene', label: '适用场景', children: selected.scene || '-' }, { key: 'problem', label: '问题类型', children: capability.problemType || selected.problem_type || '-' }, { key: 'time', label: '时间维度', children: contractUsable ? timeDimensionLabel(config, horizon) : contractLoading ? '正在读取契约' : '契约不可用' }, { key: 'solver', label: '默认求解器', children: capability.problemType === 'NLP' ? 'Ipopt' : 'HiGHS' }]} />}{contractFailed && <Alert className="section-gap" showIcon type="error" message="模型运行参数契约加载失败" description="当前无法确认输入参数和时间维度，请重新加载后再继续。" action={<Button onClick={retryContract}>重新加载契约</Button>} />}{contractPartial && <Alert className="section-gap" showIcon type="warning" message="部分契约接口不可用" description={`当前使用${detailUsable ? '模型详情' : '模型 Schema'}作为兼容契约来源，可继续创建任务。`} />}</Card></div>}
    {step === 1 && <div className="wizard-step"><Card title="确认调度周期与求解器" loading={contractLoading}>
      {config.policy === 'not_applicable' && <Alert showIcon type="info" message="该模型不使用调度周期" />}
      {config.policy === 'fixed' && <Alert showIcon type="info" message={`固定调度周期：${config.default_horizon ?? '-'} 点（只读）`} />}
      {config.policy === 'data_derived' && <Alert showIcon type={effectiveHorizon ? 'info' : 'warning'} message={effectiveHorizon ? `已从 ${config.derive_from || '主时间序列'} 推导 ${effectiveHorizon} 点` : `调度周期将由 ${config.derive_from || '主时间序列'} 自动推导，当前尚无法推导`} />}
      {config.policy === 'runtime_variable' && <div className="runtime-control"><label>调度周期</label>{config.allowed_horizons.length ? <Select aria-label="调度周期" value={horizon} onChange={value => { setHorizon(value); setDirty(true); }} options={config.allowed_horizons.map(value => ({ value, label: `${value} 点${config.interval_minutes_by_horizon[String(value)] ? ` · ${config.interval_minutes_by_horizon[String(value)]} 分钟粒度` : ''}` }))} /> : <InputNumber aria-label="调度周期" value={horizon} min={config.min_horizon || 1} max={config.max_horizon} step={config.horizon_step || 1} onChange={value => { setHorizon(value ?? undefined); setDirty(true); }} />}</div>}
      <div className="runtime-control"><label>求解器</label><Select aria-label="求解器" value={solver} onChange={value => { setSolver(value); setDirty(true); }} options={capability.problemType === 'NLP' ? [{ value: 'Ipopt', label: 'Ipopt' }] : [{ value: 'HiGHS', label: 'HiGHS' }]} /></div>
    </Card><Card className="section-gap" title="填写业务输入" extra={<Tag>{visibleFields.length} 个字段</Tag>}>
      <div className="parameter-field-list">{visibleFields.map(field => { const fieldError = editorErrors[field.code] || (config.policy === 'data_derived' && field.code === config.derive_from ? validateRuntimeTimeDimension(config, fields, parameters, horizon)[0] : ''); return <div className={`parameter-field${fieldError ? ' parameter-field-error' : ''}`} key={field.code}><div className="parameter-field-label"><strong>{field.name}</strong>{field.required && <Tag color="red">必填</Tag>}<code>{field.code}</code>{field.unit && <span>{field.unit}</span>}</div>{field.description && <p>{field.description}</p>}<ParameterEditor field={field} value={parameters[field.code]} onChange={value => update(field.code, value)} onValidityChange={error => setEditorErrors(current => ({ ...current, [field.code]: error || '' }))} expectedLength={field.dimension.includes(config.state_time_set || '__none__') ? effectiveHorizon ? effectiveHorizon + 1 : undefined : field.dimension.includes(config.time_set) ? effectiveHorizon : undefined} /></div>; })}</div>
      {!visibleFields.length && contractUsable && !contractLoading && <Alert showIcon type="info" message="当前模型未声明需要手工填写的业务参数" />}
    </Card><Card className="section-gap" title="高级输入（可选）"><Button onClick={() => setAdvancedOpen(value => !value)}>{advancedOpen ? '收起 JSON 导入' : '展开 JSON 导入'}</Button>{advancedOpen && <div className="section-gap-tight"><Input.TextArea rows={5} value={jsonText} onChange={event => { setJsonText(event.target.value); setDirty(true); }} placeholder='{"load_forecast":[100,120]}' /><Button className="section-gap-tight" onClick={importJson}>导入并合并</Button></div>}</Card>{validationErrors.length > 0 && <Alert className="section-gap" showIcon type="warning" message="请修正以下问题" description={<ul>{validationErrors.map(error => <li key={error}>{error}</li>)}</ul>} />}</div>}
    {step === 2 && <div className="wizard-step"><Alert showIcon type={validationErrors.length ? 'warning' : 'success'} message={validationErrors.length ? `发现 ${validationErrors.length} 个待修正问题` : '参数检查通过，可以提交求解'} description={validationErrors.length ? validationErrors.join('；') : '系统时间字段将由模型契约管理，提交结构保持与现有接口兼容。'} />{submitError && <Alert className="section-gap" showIcon type="error" message={submitError} />}<Descriptions className="section-gap" bordered size="small" column={1} items={[{ key: 'model', label: '模型', children: selected?.name || modelId }, { key: 'time', label: '调度周期', children: timeDimensionLabel(config, effectiveHorizon) }, { key: 'solver', label: '求解器', children: solver }, { key: 'params', label: '业务参数', children: `${Object.keys(parameters).length} 项` }]} /><Card className="section-gap" size="small" title="提交内容预览"><pre className="payload-preview">{JSON.stringify(buildTaskPayload({ model_id: modelId, solver, horizon, parameters }, config), null, 2)}</pre></Card></div>}
  </Drawer>;
}
