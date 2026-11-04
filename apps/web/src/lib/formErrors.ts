import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/api/client';

export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
) {
  if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
    for (const d of err.details as { field: string; message: string }[]) {
      setError(d.field as Path<T>, { message: d.message });
    }
    return;
  }
  setError('root' as Path<T>, {
    message: err instanceof Error ? err.message : 'Something went wrong',
  });
}
