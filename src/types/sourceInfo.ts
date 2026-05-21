export type SourceInfo = {
  displayName: string;
  /** 请求明细「供应商 / 模型」列用的展示名（name → prefix 降级） */
  requestDisplayName?: string;
  type: string;
  identityKey?: string;
};

export type CredentialInfo = {
  name: string;
  type: string;
  statusMessage?: string;
};
