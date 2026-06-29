import { Card, Col, Descriptions, Row, Tag } from 'antd';
import { PageHeader } from '../../components/PageHeader';

interface SettingsPageProps {
  variant?: 'settings' | 'runtime';
}

export function SettingsPage({ variant = 'settings' }: SettingsPageProps) {
  const apiBase = import.meta.env.VITE_API_BASE_URL || '同源 /api（开发代理）';
  const isRuntime = variant === 'runtime';
  return (
    <>
      <PageHeader
        title={isRuntime ? '求解运行环境' : '系统配置'}
        description={isRuntime ? '查看求解器、API 连接、运行入口和 legacy 兼容状态。' : '查看 API 连接、求解器、前端托管和 legacy 入口状态。'}
        status={<Tag color="blue">HiGHS</Tag>}
      />
      <Row gutter={[14, 14]}>
        <Col xs={24} md={8}><div className="card metric blue"><span>API 地址</span><b>8000</b><span>{apiBase}</span></div></Col>
        <Col xs={24} md={8}><div className="card metric green"><span>求解器</span><b>HiGHS</b><span>Pyomo + highspy</span></div></Col>
        <Col xs={24} md={8}><div className="card metric amber"><span>Legacy</span><b>保留</b><span>/legacy / prototype.html</span></div></Col>
      </Row>
      <Card className="content-card section-gap" title="运行配置">
        <Descriptions column={1} bordered>
          <Descriptions.Item label="API 地址">{apiBase}</Descriptions.Item>
          <Descriptions.Item label="求解器">HiGHS</Descriptions.Item>
          <Descriptions.Item label="React 开发入口">http://localhost:5173</Descriptions.Item>
          <Descriptions.Item label="FastAPI 生产入口">http://localhost:8000/</Descriptions.Item>
          <Descriptions.Item label="Legacy 入口"><a href="/legacy" target="_blank">/legacy</a></Descriptions.Item>
          <Descriptions.Item label="旧原型路径"><a href="/prototype.html" target="_blank">/prototype.html</a></Descriptions.Item>
        </Descriptions>
      </Card>
    </>
  );
}
