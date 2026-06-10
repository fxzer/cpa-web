/**
 * 通用错误处理工具
 */

/**
 * 从未知类型的错误值中提取错误信息字符串
 */
export const getErrorMessage = (error: unknown, fallback?: string): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback ?? '';
};
