import { Alert, Input, Modal } from 'antd';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, setPlatformApiToken } from '../../api/client';

export function PlatformAccess() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  useEffect(() => {
    const required = () => setOpen(true);
    window.addEventListener('optiforge:auth-required', required);
    return () => window.removeEventListener('optiforge:auth-required', required);
  }, []);
  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      setPlatformApiToken(token);
      await apiClient.get('/api/llm/config', { suppressErrorToast: true });
      setOpen(false);
      setToken('');
      await queryClient.invalidateQueries();
    } catch {
      sessionStorage.removeItem('optiforge-platform-token');
      setError('访问令牌无效或连接失败，请核对后重试。');
    } finally { setBusy(false); }
  };
  return <Modal open={open} title="请输入平台访问令牌" okText="连接平台" cancelText="稍后" confirmLoading={busy} onOk={unlock} onCancel={() => setOpen(false)}>
    <p>此部署已启用访问令牌。令牌仅保存在当前标签页会话中。</p>
    <Input.Password aria-label="平台访问令牌" value={token} onChange={event => setToken(event.target.value)} onPressEnter={unlock} autoComplete="off" />
    {error && <Alert className="section-gap" type="error" title={error} />}
  </Modal>;
}
