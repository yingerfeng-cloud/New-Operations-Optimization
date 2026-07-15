import { Button, Card, Segmented, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getModels } from '../../api/models';
import { getSystemConfig } from '../../api/systemConfig';
import { PageHeader } from '../../components/PageHeader';
import { ConfigurationMissingState } from '../../components/PageStates';
import { StatusTag } from '../../components/StatusTag';
import { FilterBar, MetricCard } from '../../components/WorkspaceUI';
import { scenarioCatalog, scenariosFromDictionary } from '../../features/model-creation/data/scenarioCatalog';
import type { ScenarioCatalogItem, ScenarioModelItem } from '../../types/scenario';

const statusOptions = ['全部', '已发布', '试运行'];

function statusLabel(status: string) {
  return status === 'trial' ? '试运行' : status === 'published' ? '已发布' : status;
}

function modelBelongsToScenario(model: Record<string, unknown>, scenario: ScenarioCatalogItem, catalogModel?: ScenarioModelItem) {
  const values = [
    model.scene,
    model.scenario,
    model.template_id,
    model.model_code,
    model.resolved_model_code,
    model.code,
  ].map(value => String(value || ''));
  const modelCodes = scenario.models.map(item => item.code);
  const templateCodes = scenario.models.map(item => item.templateCode).filter(Boolean);
  if (values.includes(scenario.id) || values.includes(scenario.name)) return true;
  if (catalogModel && (values.includes(catalogModel.id) || values.includes(catalogModel.code) || values.includes(catalogModel.templateCode || ''))) return true;
  return values.some(value => modelCodes.includes(value) || templateCodes.includes(value));
}

function publishedStatus(status: unknown) {
  return ['published', 'trial', 'tested', '已发布', '试运行', '已测试'].includes(String(status || ''));
}

function builderText(value: unknown) {
  return value === 'component_based' ? '组件化 Builder' : '通用线性 Builder';
}

export function ScenarioLibraryPage() {
  const nav = useNavigate();
  const [filter, setFilter] = useState('全部');
  const [statusFilter, setStatusFilter] = useState('全部');
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const config = useQuery({ queryKey: ['system-config'], queryFn: getSystemConfig, retry: false });
  const scenarios = useMemo(() => scenariosFromDictionary(config.data?.dictionaries?.business_scenarios), [config.data]);
  const visible = scenarios.filter(item => {
    const sceneMatched = filter === '全部' || item.name === filter;
    const statusMatched = statusFilter === '全部' || statusLabel(item.status) === statusFilter;
    return sceneMatched && statusMatched;
  });

  const rows = useMemo(() => visible.map(scenario => {
    const ownedModels = (models.data || []).filter(model => modelBelongsToScenario(model, scenario));
    return {
      ...scenario,
      ownedModelCount: ownedModels.length,
      publishedModelCount: ownedModels.filter(model => publishedStatus(model.status)).length,
      recommendedModelCount: scenario.models.length,
      recommendedModelId: ownedModels.find(model => publishedStatus(model.status))?.id,
    };
  }), [models.data, visible]);

  const openModelCreation = (scenarioId: string, modelId: string) => {
    const templateCode = scenarios.find(item => item.id === scenarioId)?.models.find(model => model.id === modelId)?.templateCode;
    nav(templateCode ? `/models/create?mode=template&template=${encodeURIComponent(templateCode)}` : '/models/create?mode=new');
  };
  const firstScenario = scenarios[0];

  return (
    <>
      <PageHeader
        title="业务场景库"
        description="按业务场景组织模型模板和建模入口，支持快速进入建模或发起求解。"
        extra={<Button type="primary" disabled={!firstScenario?.models[0]} onClick={() => firstScenario?.models[0] && openModelCreation(firstScenario.id, firstScenario.models[0].id)}>进入建模</Button>}
      />
      {!scenarios.length && (
        <ConfigurationMissingState
          title="暂无可用业务场景"
          description="所有业务场景均已禁用，无法进入建模。请先检查系统字典配置。"
          action={<Button onClick={() => nav('/settings')}>查看系统配置</Button>}
        />
      )}
      {!!scenarios.length && <>
      <Card className="content-card">
        <FilterBar onReset={() => { setFilter('全部'); setStatusFilter('全部'); }}>
          <Segmented value={filter} onChange={value => setFilter(String(value))} options={['全部', ...scenarios.map(item => item.name)]} />
          <Segmented value={statusFilter} onChange={value => setStatusFilter(String(value))} options={statusOptions} />
        </FilterBar>
      </Card>

      <div className="dashboard-insight-grid section-gap">
        {rows.map(scenario => (
          <Card
            data-testid={`scenario-card-${scenario.id}`}
            key={scenario.id}
            className="content-card"
            title={<Space><span>{scenario.name}</span><StatusTag status={scenario.status} /></Space>}
            extra={<Tag color="blue">推荐模型 {scenario.recommendedModelCount}</Tag>}
          >
            <Typography.Paragraph>{scenario.description}</Typography.Paragraph>
            <div className="metric-grid metric-grid-2">
              <MetricCard title="模型资产" value={scenario.ownedModelCount} tone="blue" />
              <MetricCard title="已发布模型" value={scenario.publishedModelCount} tone="green" />
            </div>
            <Space wrap className="section-gap">
              <Button data-testid={`scenario-enter-${scenario.id}`} type="primary" disabled={!scenario.models[0]} onClick={() => scenario.models[0] && openModelCreation(scenario.id, scenario.models[0].id)}>进入建模</Button>
              <Button disabled={!scenario.recommendedModelId} title={!scenario.recommendedModelId ? '暂无已发布模型' : undefined} onClick={() => nav(`/tasks?create=1&scene=${encodeURIComponent(scenario.name)}&model=${encodeURIComponent(scenario.recommendedModelId || '')}`)}>使用推荐模型发起任务</Button>
              <Button onClick={() => nav('/models/create?mode=new')}>创建空白模型</Button>
            </Space>
            <div className="scenario-model-list">
              {scenario.models.map(model => (
                <div className="scenario-model-item" key={model.id}>
                  <div className="scenario-model-main">
                    <strong>{model.name}</strong>
                    <span className="scenario-model-code">{model.code}</span>
                    <div className="scenario-model-meta">
                      <StatusTag status={scenario.status} />
                      <Tag color="geekblue">{builderText(model.builderMode)}</Tag>
                      <Tag color="purple">{model.problemType}</Tag>
                    </div>
                  </div>
                  <div className="scenario-model-action">
                    <Button onClick={() => openModelCreation(scenario.id, model.id)}>进入建模</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      </>}
    </>
  );
}
