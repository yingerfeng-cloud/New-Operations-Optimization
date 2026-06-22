import { Tag } from 'antd';
export function StatusTag({status}:{status?:string}){const s=status||'unknown';const color=/success|published|valid/i.test(s)?'green':/fail|error|offline|cancel/i.test(s)?'red':/running|solving|test/i.test(s)?'blue':'gold';return <Tag color={color}>{s}</Tag>}
