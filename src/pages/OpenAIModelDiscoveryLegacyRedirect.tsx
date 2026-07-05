import { useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * 兼容书签/外链 /ai-providers/openai/:index/models：重定向回编辑页并打开批量测试弹窗。
 */
export function OpenAIModelDiscoveryLegacyRedirect() {
  const navigate = useNavigate();
  const ranRef = useRef(false);

  useLayoutEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    navigate('..', { replace: true, state: { openModelDiscovery: true } });
  }, [navigate]);

  return null;
}
