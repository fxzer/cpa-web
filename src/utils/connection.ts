import { DEFAULT_API_PORT, MANAGEMENT_API_PREFIX } from './constants';

export const normalizeApiBase = (input: string): string => {
  let base = (input || '').trim();
  if (!base) return '';
  base = base.replace(/\/?v0\/management\/?$/i, '');
  base = base.replace(/\/+$/i, '');
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base;
};

export const computeApiUrl = (base: string): string => {
  const normalized = normalizeApiBase(base);
  if (!normalized) return '';
  return `${normalized}${MANAGEMENT_API_PREFIX}`;
};

export const detectApiBaseFromLocation = (): string => {
  try {
    const { protocol, hostname, port } = window.location;
    const normalizedPort = port ? `:${port}` : '';
    const detected = normalizeApiBase(`${protocol}//${hostname}${normalizedPort}`);

    // 开发模式下（例如 Vite :5173），检测到的端口与 cpa-core 默认端口不同。
    // 此时自动建议 localhost:${DEFAULT_API_PORT}，用户无需手动修改。
    // 生产环境（cpa-core 托管 HTML）或远程访问时，检测到的端口就是实际端口，直接使用。
    if (isLocalhost(hostname) && port && Number(port) !== DEFAULT_API_PORT) {
      return normalizeApiBase(`http://localhost:${DEFAULT_API_PORT}`);
    }

    return detected;
  } catch (error) {
    console.warn('Failed to detect api base from location, fallback to default', error);
    return normalizeApiBase(`http://localhost:${DEFAULT_API_PORT}`);
  }
};

export const isLocalhost = (hostname: string): boolean => {
  const value = (hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '[::1]';
};
