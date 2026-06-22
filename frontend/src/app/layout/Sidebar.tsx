import { DashboardOutlined, DatabaseOutlined, ExperimentOutlined, AppstoreOutlined, ScheduleOutlined, BarChartOutlined, RobotOutlined, SettingOutlined } from '@ant-design/icons';
import { Menu } from 'antd'; import { useLocation, useNavigate } from 'react-router-dom';
const items = [
  ['/', <DashboardOutlined/>, '总览驾驶舱'], ['/models', <DatabaseOutlined/>, '模型资产中心'], ['/models/create', <ExperimentOutlined/>, '模型创建'],
  ['/components', <AppstoreOutlined/>, '组件库管理'], ['/tasks', <ScheduleOutlined/>, '任务调度中心'], ['/results', <BarChartOutlined/>, '结果报告库'],
  ['/agents', <RobotOutlined/>, 'Agent 工作台'], ['/settings', <SettingOutlined/>, '系统配置'],
].map(([key, icon, label]) => ({ key: key as string, icon, label }));
export function Sidebar(){ const nav=useNavigate(); const {pathname}=useLocation(); const selected=items.find(x=>x.key!=='/'&&pathname.startsWith(x.key))?.key || '/'; return <><div className="brand"><div className="brand-mark">优</div><div>运筹优化平台<small>Pyomo + HiGHS</small></div></div><Menu theme="dark" mode="inline" selectedKeys={[selected]} items={items} onClick={({key})=>nav(key)}/></>; }
