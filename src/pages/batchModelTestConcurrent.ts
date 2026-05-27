import { runWithConcurrency } from '@/utils/concurrency';
import type { BatchModelTestProgress, BatchModelTestRowResult } from './BatchModelTestModalShell';

export const BATCH_MODEL_TEST_CONCURRENCY = 8;

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

export const buildBatchModelTestFailure = (
  err: unknown,
  timeoutMs: number,
  timeoutMessage: (seconds: number) => string
): BatchModelTestRowResult => {
  const message = getErrorMessage(err);
  const errorCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: string }).code)
      : '';
  const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout');
  return {
    success: false,
    message: isTimeout ? timeoutMessage(timeoutMs / 1000) : message,
  };
};

export async function runBatchModelTestsConcurrent({
  modelNames,
  concurrency = BATCH_MODEL_TEST_CONCURRENCY,
  testModel,
  onProgress,
  onResult,
}: {
  modelNames: string[];
  concurrency?: number;
  testModel: (modelName: string) => Promise<BatchModelTestRowResult>;
  onProgress: (progress: BatchModelTestProgress) => void;
  onResult: (results: Record<string, BatchModelTestRowResult>) => void;
}): Promise<Record<string, BatchModelTestRowResult>> {
  const results: Record<string, BatchModelTestRowResult> = {};
  const runningModels = new Set<string>();
  let completed = 0;

  const emitProgress = () => {
    onProgress({
      completed,
      total: modelNames.length,
      runningModels: Array.from(runningModels),
    });
  };

  emitProgress();

  await runWithConcurrency(modelNames, concurrency, async (modelName) => {
    runningModels.add(modelName);
    emitProgress();

    try {
      results[modelName] = await testModel(modelName);
    } finally {
      runningModels.delete(modelName);
      completed += 1;
      onResult({ ...results });
      emitProgress();
    }
  });

  return results;
}
