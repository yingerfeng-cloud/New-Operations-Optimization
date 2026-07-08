import {
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  LineChartOutlined,
  RobotOutlined,
  ScheduleOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

export interface NavEntry {
  key: string;
  label: string;
  description: string;
  icon: ReactNode;
  group: '核心业务' | '工具与运行' | '分析与接口' | '系统';
}

export const navEntries: NavEntry[] = [
  { key: '/', label: '总览驾驶舱', description: '业务场景、模型资产、组件库、任务和结果的统一入口', icon: <DashboardOutlined />, group: '核心业务' },
  { key: '/scenarios', label: '业务场景库', description: '统一场景目录、模型列表和建模入口', icon: <AppstoreOutlined />, group: '核心业务' },
  { key: '/models/create', label: '模型创建', description: '五步创建模型，维护语义、公式、组件和运行参数', icon: <ExperimentOutlined />, group: '核心业务' },
  { key: '/models', label: '模型资产中心', description: '模型版本、发布治理、模板克隆和测试运行', icon: <DatabaseOutlined />, group: '核心业务' },
  { key: '/components', label: '组件库管理', description: '可复用约束组件、参数绑定和依赖校验', icon: <AppstoreOutlined />, group: '工具与运行' },
  { key: '/functions', label: '函数/曲线资产中心', description: '分段曲线、公式函数、函数映射引用和校验预览', icon: <LineChartOutlined />, group: '工具与运行' },
  { key: '/runtime', label: '求解运行环境', description: '求解器、运行参数、API 状态和环境连通性', icon: <ThunderboltOutlined />, group: '工具与运行' },
  { key: '/tasks', label: '任务调度中心', description: '提交、监控、取消和查看求解任务', icon: <ScheduleOutlined />, group: '工具与运行' },
  { key: '/results', label: '结果报告库', description: '关键指标、变量曲线、业务解释和 JSON 结果', icon: <BarChartOutlined />, group: '分析与接口' },
  { key: '/services', label: '模型服务接口', description: '已发布模型服务、接口契约、调用示例和调用记录', icon: <ApiOutlined />, group: '分析与接口' },
  { key: '/skills', label: 'Skill 服务中心', description: 'Skill 启停、Schema 同步、Agent 绑定、在线测试和调用记录', icon: <ApiOutlined />, group: '分析与接口' },
  { key: '/agents', label: 'Agent 工作台', description: '对话式建模、意图识别、参数抽取和调用日志', icon: <RobotOutlined />, group: '分析与接口' },
  { key: '/settings', label: '系统配置', description: 'API 连接、求解器、环境和 React 前端托管状态', icon: <SettingOutlined />, group: '系统' },
];

export function titleForPath(pathname: string): NavEntry {
  return (
    navEntries
      .filter(entry => entry.key !== '/' && (pathname === entry.key || pathname.startsWith(`${entry.key}/`)))
      .sort((a, b) => b.key.length - a.key.length)[0] ||
    navEntries[0]
  );
}
