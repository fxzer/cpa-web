/**
 * 版本相关 API
 * 检查更新请求连接的后端 GET /latest-version；查询哪个 GitHub 仓库由服务端配置（如 remote-management.panel-github-repository）决定，本前端不写死仓库。
 */

import { apiClient } from './client';

export const versionApi = {
  checkLatest: () => apiClient.get<Record<string, unknown>>('/latest-version')
};
