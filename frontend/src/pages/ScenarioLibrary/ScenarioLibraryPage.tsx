import { Button, Card, Segmented, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getModels } from '../../api/models';
import { getSystemConfig } from '../../api/systemConfig';
import { PageHeader } from '../../components/PageHeader';
import { ConfigurationMissingState } from '../../components/PageStates';
import { StatusTag } from '../../components/StatusTag';
import { FilterBar, MetricCard, MetricGrid } from '../../components/WorkspaceUI';
import { modelBelongsToScenario, recommendScenarioModels, scenariosFromDictionary } from '../../features/model-creation/data/scenarioCatalog';

const statusOptions = ['全部', '草稿', '试运行', '已发布', '已下线'];

function statusLabel(status: string) {
  return ({ draft: '草稿', trial: '试运行', published: '已发布', offline: '已下线' } as Record<string, string>)[status] || status;
}

function builderText(value: unknown) {
  if (value === 'component_based') return '组件化 Builder';
  if (value === 'domain_builder') return '领域 Builder';
  if (value === 'template_based') return '模板 Builder';
  return '通用线性 Builder';
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
    const recommendedModels = recommendScenarioModels(models.data || [], scenario);
    return {
      ...scenario,
      ownedModels,
      ownedModelCount: ownedModels.length,
      publishedModelCount: ownedModels.filter(model => model.status === 'published').length,
      trialModelCount: ownedModels.filter(model => model.status === 'trial').length,
      recommendedModels,
      recommendedModel: recommendedModels[0],
      displayModel: recommendedModels[0] || ownedModels[0],
    };
  }), [models.data, visible]);

  return (
    <>
      <PageHeader
        title="业务场景库"
        description="业务场景状态来自系统配置；推荐结果来自该场景下实际可运行的已发布模型。"
        extra={<Button type="primary" disabled={!scenarios.length} onClick={() => nav('/models/create?mode=new')}>进入建模</Button>}
      />
      {!config.isPending && !scenarios.length && (
        <ConfigurationMissingState
          title="暂无可用业务场景"
          description="尚未配置或所有业务场景均已禁用。请先检查系统字典配置。"
          action={<Button onClick={() => nav('/settings')}>查看系统配置</Button>}
        />
      )}
      {!!scenarios.length && <>
        <Card className="content-card">
          <FilterBar>
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
              extra={<Button size="small" onClick={() => nav(`/models/create?mode=new&scenario=${encodeURIComponent(scenario.id)}`)}>创建空白模型</Button>}
            >
              <Typography.Paragraph>{scenario.description || '暂无场景说明'}</Typography.Paragraph>
              <MetricGrid columns={3}>
                <MetricCard title="模型资产" value={scenario.ownedModelCount} tone="blue" />
                <MetricCard title="已发布模型" value={scenario.publishedModelCount} tone="green" />
                <MetricCard title="试运行模型" value={scenario.trialModelCount} tone="purple" />
              </MetricGrid>
              <div className="scenario-model-list">
                {scenario.displayModel ? (
                  <>
                    <div className="scenario-model-item scenario-featured-model" key={scenario.displayModel.id}>
                      <div className="scenario-model-main">
                        <div className="scenario-model-heading"><strong>{scenario.displayModel.name}</strong></div>
                        <span className="scenario-model-code">{String(scenario.displayModel.template_id || scenario.displayModel.id)}</span>
                        {scenario.ownedModelCount > 1 && <Typography.Text type="secondary">另有 {scenario.ownedModelCount - 1} 个模型，已收起</Typography.Text>}
                        <div className="scenario-model-action">
                          <Button size="small" onClick={() => nav(`/models/create?mode=${scenario.displayModel?.status === 'developing' ? 'edit' : 'version'}&source=${encodeURIComponent(scenario.displayModel?.id || '')}`)}>进入建模</Button>
                        </div>
                      </div>
                      <div className="scenario-model-meta">
                        <StatusTag status={scenario.displayModel.status} />
                        <Tag color="geekblue">{builderText(scenario.displayModel.build_mode)}</Tag>
                        <Tag color="purple">{scenario.displayModel.model_problem_type || scenario.displayModel.problem_type}</Tag>
                      </div>
                    </div>
                  </>
                ) : (
                  <Typography.Text type="secondary">该场景尚未关联模型资产</Typography.Text>
                )}
              </div>
            </Card>
          ))}
        </div>
      </>}
    </>
  );
}
