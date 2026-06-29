import { Button, Card, Col, Collapse, Row, Segmented, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getModels } from '../../api/models';
import { PageHeader } from '../../components/PageHeader';
import { StatusTag } from '../../components/StatusTag';
import { BLANK_MODEL_ID, scenarioCatalog } from '../../features/model-creation/data/scenarioCatalog';
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

export function ScenarioLibraryPage() {
  const nav = useNavigate();
  const [filter, setFilter] = useState('全部');
  const [statusFilter, setStatusFilter] = useState('全部');
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const scenarios = scenarioCatalog;
  const visible = scenarios.filter(item => {
    const sceneMatched = filter === '全部' || item.name === filter;
    const statusMatched = statusFilter === '全部' || statusLabel(item.status) === statusFilter;
    return sceneMatched && statusMatched;
  });

  const rows = useMemo(() => visible.map(scenario => {
    const ownedModels = (models.data || []).filter(model => modelBelongsToScenario(model, scenario));
    return {
      ...scenario,
      ownedModelCount: ownedModels.length || scenario.models.length,
      publishedModelCount: ownedModels.filter(model => publishedStatus(model.status)).length,
    };
  }), [models.data, visible]);

  const openModelCreation = (scenarioId: string, modelId: string) => {
    nav(`/models/create?scenarioId=${encodeURIComponent(scenarioId)}&modelId=${encodeURIComponent(modelId)}`);
  };

  return (
    <>
      <PageHeader
        title="业务场景库"
        description="统一业务场景目录，按场景进入建模、创建空白模型或发起求解。"
        extra={<Button type="primary" onClick={() => openModelCreation(scenarios[0].id, scenarios[0].models[0].id)}>进入建模</Button>}
      />
      <Card className="content-card">
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Segmented
            value={filter}
            onChange={value => setFilter(String(value))}
            options={['全部', ...scenarios.map(item => item.name)]}
          />
          <Segmented
            value={statusFilter}
            onChange={value => setStatusFilter(String(value))}
            options={statusOptions}
          />
        </Space>
      </Card>
      <Row gutter={[14, 14]} className="section-gap">
        {rows.map(scenario => (
          <Col xs={24} lg={12} key={scenario.id}>
            <Card
              data-testid={`scenario-card-${scenario.id}`}
              className="content-card"
              title={<Space><span>{scenario.name}</span><StatusTag status={scenario.status} /></Space>}
              extra={<Tag color="blue">{scenario.ownedModelCount} 个模型</Tag>}
            >
              <Typography.Paragraph>{scenario.description}</Typography.Paragraph>
              <Row gutter={12}>
                <Col span={12}><div className="metric compact"><span>归属模型数量</span><b>{scenario.ownedModelCount}</b></div></Col>
                <Col span={12}><div className="metric compact green"><span>已发布模型数量</span><b>{scenario.publishedModelCount}</b></div></Col>
              </Row>
              <Space wrap className="section-gap">
                <Button data-testid={`scenario-enter-${scenario.id}`} type="primary" onClick={() => openModelCreation(scenario.id, scenario.models[0].id)}>进入建模</Button>
                <Button onClick={() => nav('/tasks')}>发起求解</Button>
                <Button onClick={() => openModelCreation(scenario.id, BLANK_MODEL_ID)}>创建空白模型</Button>
              </Space>
              <Collapse
                className="section-gap"
                defaultActiveKey={['models']}
                items={[{
                  key: 'models',
                  label: '场景下模型列表',
                  children: (
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="id"
                      dataSource={scenario.models}
                      columns={[
                        { title: '模型名称', dataIndex: 'name' },
                        { title: '模型编码', dataIndex: 'code' },
                        { title: '状态', render: () => <StatusTag status={scenario.status} /> },
                        { title: '问题类型', dataIndex: 'problemType' },
                        {
                          title: '操作',
                          render: (_, model) => <Button type="link" onClick={() => openModelCreation(scenario.id, model.id)}>进入建模</Button>,
                        },
                      ]}
                    />
                  ),
                }]}
              />
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}
