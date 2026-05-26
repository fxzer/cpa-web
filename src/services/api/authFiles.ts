/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import { apiClient } from './client';
import type { AuthFilesResponse } from '@/types/authFile';
import type { AuthFileModelConfigRow, AuthFileModelsConfigResponse } from '@/types';
import { parseTimestampMs } from '@/utils/timestamp';

type AuthFileStatusResponse = { status: string; disabled: boolean };
type AuthFileEntry = AuthFilesResponse['files'][number];
export type AuthFileFieldsPatch = {
  prefix?: string;
  proxy_url?: string;
  headers?: Record<string, string>;
  priority?: number;
  note?: string;
};
type AuthFileBatchFailure = { name: string; error: string };
type AuthFileBatchUploadResponse = {
  status?: string;
  uploaded?: number;
  files?: unknown;
  failed?: unknown;
};
type AuthFileBatchDeleteResponse = {
  status?: string;
  deleted?: number;
  files?: unknown;
  failed?: unknown;
};
type AuthFileBatchUploadResult = {
  status: string;
  uploaded: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};
type AuthFileBatchDeleteResult = {
  status: string;
  deleted: number;
  files: string[];
  failed: AuthFileBatchFailure[];
};

export const AUTH_FILE_INVALID_JSON_OBJECT_ERROR = 'AUTH_FILE_INVALID_JSON_OBJECT';

const normalizeRequestedAuthFileNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  names.forEach((name) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

const normalizeBatchFileNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return normalizeRequestedAuthFileNames(value.map((item) => String(item ?? '')));
};

const normalizeBatchFailures = (value: unknown): AuthFileBatchFailure[] => {
  if (!Array.isArray(value)) return [];

  return value.reduce<AuthFileBatchFailure[]>((result, item) => {
    if (!item || typeof item !== 'object') return result;
    const entry = item as Record<string, unknown>;
    const name = String(entry.name ?? '').trim();
    const error =
      typeof entry.error === 'string'
        ? entry.error.trim()
        : typeof entry.message === 'string'
          ? entry.message.trim()
          : '';

    if (!name && !error) return result;
    result.push({ name, error: error || 'Unknown error' });
    return result;
  }, []);
};

const deriveSuccessfulFileNames = (
  requestedNames: string[],
  failed: AuthFileBatchFailure[]
): string[] => {
  const failedNames = new Set(failed.map((entry) => entry.name.trim()).filter(Boolean));

  if (failedNames.size === 0) {
    return [...requestedNames];
  }

  return requestedNames.filter((name) => !failedNames.has(name));
};

const normalizeBatchUploadResponse = (
  payload: AuthFileBatchUploadResponse | undefined,
  requestedNames: string[]
): AuthFileBatchUploadResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const uploadedFilesFromPayload = normalizeBatchFileNames(payload?.files);
  const uploaded =
    typeof payload?.uploaded === 'number'
      ? payload.uploaded
      : uploadedFilesFromPayload.length > 0
        ? uploadedFilesFromPayload.length
        : requestedNames.length === 1 && failed.length === 0
          ? 1
          : 0;

  let uploadedFiles = uploadedFilesFromPayload;
  if (uploadedFiles.length === 0 && uploaded > 0) {
    if (failed.length === 0 && uploaded === requestedNames.length) {
      uploadedFiles = [...requestedNames];
    } else {
      const derivedNames = deriveSuccessfulFileNames(requestedNames, failed);
      if (derivedNames.length === uploaded) {
        uploadedFiles = derivedNames;
      }
    }
  }

  return {
    status:
      typeof payload?.status === 'string' ? payload.status : failed.length > 0 ? 'partial' : 'ok',
    uploaded,
    files: uploadedFiles,
    failed,
  };
};

const normalizeBatchDeleteResponse = (
  payload: AuthFileBatchDeleteResponse | undefined,
  requestedNames: string[]
): AuthFileBatchDeleteResult => {
  const failed = normalizeBatchFailures(payload?.failed);
  const deletedFilesFromPayload = normalizeBatchFileNames(payload?.files);
  const deleted =
    typeof payload?.deleted === 'number'
      ? payload.deleted
      : deletedFilesFromPayload.length > 0
        ? deletedFilesFromPayload.length
        : requestedNames.length === 1 && failed.length === 0
          ? 1
          : 0;

  let deletedFiles = deletedFilesFromPayload;
  if (deletedFiles.length === 0 && deleted > 0) {
    if (failed.length === 0 && deleted === requestedNames.length) {
      deletedFiles = [...requestedNames];
    } else {
      const derivedNames = deriveSuccessfulFileNames(requestedNames, failed);
      if (derivedNames.length === deleted) {
        deletedFiles = derivedNames;
      }
    }
  }

  return {
    status:
      typeof payload?.status === 'string' ? payload.status : failed.length > 0 ? 'partial' : 'ok',
    deleted,
    files: deletedFiles,
    failed,
  };
};

const readTextField = (entry: AuthFileEntry, key: string): string => {
  const value = entry[key];
  return typeof value === 'string' ? value.trim() : '';
};

const readDateField = (entry: AuthFileEntry): number => {
  const candidates = [entry['modtime'], entry.modified, entry['updated_at'], entry['last_refresh']];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) {
        return asNumber < 1e12 ? asNumber * 1000 : asNumber;
      }
      const parsed = parseTimestampMs(trimmed);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
};

const isRuntimeOnlyEntry = (entry: AuthFileEntry): boolean => {
  const value = entry['runtime_only'] ?? entry.runtimeOnly;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
};

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const countMeaningfulFields = (entry: AuthFileEntry): number =>
  Object.values(entry).reduce<number>(
    (count, value) => count + (hasMeaningfulValue(value) ? 1 : 0),
    0
  );

const authFilePriorityScore = (entry: AuthFileEntry): number => {
  let score = 0;
  if (readTextField(entry, 'source').toLowerCase() === 'file') score += 32;
  if (readTextField(entry, 'path')) score += 16;
  if (!isRuntimeOnlyEntry(entry)) score += 8;
  if (entry.disabled !== true) score += 4;
  if (readDateField(entry) > 0) score += 2;
  return score;
};

const compareAuthFileEntries = (left: AuthFileEntry, right: AuthFileEntry): number => {
  const scoreDiff = authFilePriorityScore(right) - authFilePriorityScore(left);
  if (scoreDiff !== 0) return scoreDiff;

  const dateDiff = readDateField(right) - readDateField(left);
  if (dateDiff !== 0) return dateDiff;

  const fieldDiff = countMeaningfulFields(right) - countMeaningfulFields(left);
  if (fieldDiff !== 0) return fieldDiff;

  return 0;
};

const mergeAuthFileEntries = (entries: AuthFileEntry[]): AuthFileEntry => {
  const [primary, ...rest] = [...entries].sort(compareAuthFileEntries);
  const merged: AuthFileEntry = { ...primary };

  rest.forEach((entry) => {
    Object.entries(entry).forEach(([key, value]) => {
      if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
        merged[key] = value;
      }
    });
  });

  return merged;
};

const dedupeAuthFilesResponse = (payload: AuthFilesResponse): AuthFilesResponse => {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const grouped = new Map<string, AuthFileEntry[]>();

  files.forEach((entry) => {
    const name = readTextField(entry, 'name');
    const key = name || JSON.stringify(entry);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(entry);
      return;
    }
    grouped.set(key, [entry]);
  });

  const normalizedFiles = Array.from(grouped.values()).map(mergeAuthFileEntries);
  normalizedFiles.sort((left, right) =>
    readTextField(left, 'name').localeCompare(readTextField(right, 'name'), undefined, {
      sensitivity: 'accent',
    })
  );

  return {
    ...payload,
    files: normalizedFiles,
    total: normalizedFiles.length,
  };
};

const parseAuthFileJsonObject = (rawText: string): Record<string, unknown> => {
  const trimmed = rawText.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(AUTH_FILE_INVALID_JSON_OBJECT_ERROR);
  }

  return { ...(parsed as Record<string, unknown>) };
};

const saveAuthFileText = async (name: string, text: string) => {
  const file = new File([text], name, { type: 'application/json' });
  await authFilesApi.upload(file);
};

export const isAuthFileInvalidJsonObjectError = (err: unknown): boolean =>
  err instanceof Error && err.message === AUTH_FILE_INVALID_JSON_OBJECT_ERROR;

const parseAuthFileModelsConfigResponse = (
  data: Record<string, unknown>
): AuthFileModelsConfigResponse => {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const summaryRaw = (data.summary ?? {}) as Record<string, unknown>;
  return {
    provider: String(data.provider ?? ''),
    rows: rows.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? ''),
        display_name: item.display_name ? String(item.display_name) : undefined,
        type: item.type ? String(item.type) : undefined,
        owned_by: item.owned_by ? String(item.owned_by) : undefined,
        available: Boolean(item.available),
        alias: String(item.alias ?? ''),
        fork: item.fork !== false,
        disabled: Boolean(item.disabled),
      };
    }),
    summary: {
      total: Number(summaryRaw.total ?? rows.length) || 0,
      aliased: Number(summaryRaw.aliased ?? 0) || 0,
      passthrough: Number(summaryRaw.passthrough ?? 0) || 0,
      disabled: Number(summaryRaw.disabled ?? 0) || 0,
    },
  };
};

export const authFilesApi = {
  list: async () => dedupeAuthFilesResponse(await apiClient.get<AuthFilesResponse>('/auth-files')),

  setStatus: (name: string, disabled: boolean) =>
    apiClient.patch<AuthFileStatusResponse>('/auth-files/status', { name, disabled }),

  patchFields: (name: string, fields: AuthFileFieldsPatch) =>
    apiClient.patch('/auth-files/fields', { name, ...fields }),

  uploadFiles: async (files: File[]): Promise<AuthFileBatchUploadResult> => {
    const requestedNames = files.map((file) => file.name);
    if (requestedNames.length === 0) {
      return { status: 'ok', uploaded: 0, files: [], failed: [] };
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('file', file, file.name);
    });
    const payload = await apiClient.postForm<AuthFileBatchUploadResponse>('/auth-files', formData);
    return normalizeBatchUploadResponse(payload, requestedNames);
  },

  upload: (file: File) => authFilesApi.uploadFiles([file]),

  deleteFiles: async (names: string[]): Promise<AuthFileBatchDeleteResult> => {
    const requestedNames = normalizeRequestedAuthFileNames(names);
    if (requestedNames.length === 0) {
      return { status: 'ok', deleted: 0, files: [], failed: [] };
    }

    const payload = await apiClient.delete<AuthFileBatchDeleteResponse>('/auth-files', {
      data: { names: requestedNames },
    });
    return normalizeBatchDeleteResponse(payload, requestedNames);
  },

  deleteFile: (name: string) => authFilesApi.deleteFiles([name]),

  deleteAll: () => apiClient.delete('/auth-files', { params: { all: true } }),

  downloadText: async (name: string): Promise<string> => {
    const response = await apiClient.getRaw(
      `/auth-files/download?name=${encodeURIComponent(name)}`,
      {
        responseType: 'blob',
      }
    );
    const blob = response.data as Blob;
    return blob.text();
  },

  async downloadJsonObject(name: string): Promise<Record<string, unknown>> {
    const rawText = await authFilesApi.downloadText(name);
    return parseAuthFileJsonObject(rawText);
  },

  saveText: (name: string, text: string) => saveAuthFileText(name, text),

  saveJsonObject: (name: string, json: Record<string, unknown>) =>
    saveAuthFileText(name, JSON.stringify(json)),

  async getAuthFileModelsConfig(name: string): Promise<AuthFileModelsConfigResponse> {
    const data = await apiClient.get<Record<string, unknown>>(
      `/auth-files/models-config?name=${encodeURIComponent(name)}`
    );
    return parseAuthFileModelsConfigResponse(data);
  },

  async saveAuthFileModelsConfig(name: string, rows: AuthFileModelConfigRow[]): Promise<void> {
    await apiClient.patch(`/auth-files/models-config?name=${encodeURIComponent(name)}`, {
      rows: rows.map((row) => ({
        id: row.id,
        alias: row.alias ?? '',
        fork: Boolean(row.fork),
        disabled: Boolean(row.disabled),
      })),
    });
  },
};
