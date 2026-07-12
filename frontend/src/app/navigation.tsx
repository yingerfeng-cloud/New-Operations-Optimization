import {
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FunctionOutlined,
  RobotOutlined,
  ScheduleOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

export type NavGroup = '首页' | '业务建模' | '优化运行' | '智能与服务' | '专家工具';

export interface NavEntry {
  key: string;
  label: string;
  description: string;
  icon: ReactNode;
  group: NavGroup;
  audience: 'business' | 'expert' | 'all';
}

export const navEntries: NavEntry[] = [
  { key: '/', label: '首页', description: '业务场景、待办任务与优化结果总览', icon: <DashboardOutlined />, group: '首页', audience: 'all' },
  { key: '/scenarios', label: '业务场景', description: '从业务问题出发选择模型并创建任务', icon: <AppstoreOutlined />, group: '业务建模', audience: 'business' },
  { key: '/models', label: '模型资产', description: '管理已发布模型、版本与运行入口', icon: <DatabaseOutlined />, group: '业务建模', audience: 'business' },
  { key: '/tasks', label: '求解任务', description: '创建、监控、取消和重试优化任务', icon: <ScheduleOutlined />, group: '优化运行', audience: 'business' },
  { key: '/results', label: '结果分析', description: '查看指标、曲线、业务解释与完整报告', icon: <BarChartOutlined />, group: '优化运行', audience: 'business' },
  { key: '/agents', label: 'Agent 工作台', description: '用业务语言提出优化需求并跟踪执行', icon: <RobotOutlined />, group: '智能与服务', audience: 'business' },
  { key: '/services', label: '模型服务', description: '查看已发布模型服务与调用状态', icon: <ApiOutlined />, group: '智能与服务', audience: 'business' },
  { key: '/components', label: '组件资产', description: '维护可复用约束组件、绑定与依赖', icon: <AppstoreOutlined />, group: '专家工具', audience: 'expert' },
  { key: '/functions', label: '函数与曲线', description: '维护分段曲线、函数映射与诊断', icon: <FunctionOutlined />, group: '专家工具', audience: 'expert' },
  { key: '/skills', label: 'Skill 服务', description: '管理 Skill、Schema 与调用记录', icon: <ApiOutlined />, group: '专家工具', audience: 'expert' },
  { key: '/runtime', label: '求解环境', description: '查看求解器、连接与运行环境', icon: <ThunderboltOutlined />, group: '专家工具', audience: 'expert' },
  { key: '/settings', label: '系统配置', description: '维护平台字典、接口与系统配置', icon: <SettingOutlined />, group: '专家工具', audience: 'expert' },
];

export const hiddenRouteEntries: NavEntry[] = [
  { key: '/models/create', label: '新建模型', description: '五步模型创建工作台', icon: <DatabaseOutlined />, group: '业务建模', audience: 'expert' },
  { key: '/model-services', label: '模型服务', description: '模型服务兼容入口', icon: <ApiOutlined />, group: '智能与服务', audience: 'business' },
];

export function titleForPath(pathname: string): NavEntry {
  return [...hiddenRouteEntries, ...navEntries]
    .filter(entry => entry.key !== '/' && (pathname === entry.key || pathname.startsWith(`${entry.key}/`)))
    .sort((a, b) => b.key.length - a.key.length)[0] || navEntries[0];
}
