import type { ModelAlias } from '@/types';

export interface ModelEntry {
  name: string;
  alias: string;
  priority?: number;
  testModel?: string;
}

export const modelsToEntries = (models?: ModelAlias[]): ModelEntry[] => {
  if (!Array.isArray(models) || models.length === 0) {
    return [{ name: '', alias: '' }];
  }
  return models.map((model) => ({
    name: model.name || '',
    alias: model.alias || '',
    priority: model.priority,
    testModel: model.testModel,
  }));
};

export const entriesToModels = (entries: ModelEntry[]): ModelAlias[] => {
  return entries
    .filter((entry) => entry.name.trim())
    .map((entry) => {
      const model: ModelAlias = { name: entry.name.trim() };
      const alias = entry.alias.trim();
      if (alias && alias !== model.name) {
        model.alias = alias;
      }
      if (entry.priority !== undefined) {
        model.priority = entry.priority;
      }
      if (entry.testModel) {
        model.testModel = entry.testModel;
      }
      return model;
    });
};
