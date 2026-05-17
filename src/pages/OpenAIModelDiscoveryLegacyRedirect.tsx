import { useLayoutEffect, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { OpenAIEditOutletContext } from './AiProvidersOpenAIEditLayout';

/**
 * 兼容书签/外链 /ai-providers/openai/:index/models：重定向回编辑页并打开「从 /models 选择模型」弹窗。
 */
export function OpenAIModelDiscoveryLegacyRedirect() {
  const navigate = useNavigate();
  const { requestOpenModelDiscovery } = useOutletContext<OpenAIEditOutletContext>();
  const ranRef = useRef(false);

  useLayoutEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    requestOpenModelDiscovery();
    navigate('..', { replace: true });
  }, [navigate, requestOpenModelDiscovery]);

  return null;
}
