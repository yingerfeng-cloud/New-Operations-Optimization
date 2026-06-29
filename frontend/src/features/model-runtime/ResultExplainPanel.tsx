import { Alert } from 'antd'; export const ResultExplainPanel=({text}:{text?:string})=><Alert title="结果解释" description={text||'暂无自动解释'} type="info"/>;
