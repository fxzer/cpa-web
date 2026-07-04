/**
 * OAuth 相关类型
 * 基于原项目 src/modules/oauth.js
 */

// OAuth 供应商类型
export type OAuthProvider = 'codex' | 'anthropic' | 'antigravity' | 'gemini-cli' | 'kimi';

// OAuth 流程状态
export interface OAuthFlow {
  provider: OAuthProvider;
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: Date;
  interval: number;
  status: 'pending' | 'authorized' | 'expired' | 'error';
}

// OAuth 配置
export interface OAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

// OAuth 排除模型（provider -> modelId -> disabled）
export type OAuthExcludedModelsMap = Record<string, Record<string, boolean>>;

export type AuthFileModelConfigRow = {
  id: string;
  display_name?: string;
  type?: string;
  owned_by?: string;
  available: boolean;
  alias: string;
  fork: boolean;
  disabled: boolean;
};

export type AuthFileModelsConfigResponse = {
  provider: string;
  rows: AuthFileModelConfigRow[];
  summary: {
    total: number;
    aliased: number;
    passthrough: number;
    disabled: number;
  };
};

// OAuth 模型别名
export interface OAuthModelAliasEntry {
  name: string;
  alias: string;
  fork?: boolean;
}

export type OAuthModelAlias = Record<string, OAuthModelAliasEntry[]>;
