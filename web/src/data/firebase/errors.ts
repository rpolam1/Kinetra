import { DataError } from '../repositories';

export function mapFirebaseError(error: unknown): DataError {
  if (error instanceof DataError) return error;
  const code = (error as { code?: string } | null)?.code ?? '';
  if (code.includes('permission-denied') || code.includes('unauthenticated')) {
    return new DataError('permission', 'You do not have permission to do that');
  }
  if (code.includes('unavailable') || code.includes('network') || code.includes('deadline')) {
    return new DataError('unavailable', 'Cannot reach the cloud database. Check the internet connection.');
  }
  if (code.includes('not-found')) return new DataError('not_found', 'Record not found');
  return new DataError('unavailable', error instanceof Error ? error.message : 'Unexpected database error');
}

export async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw mapFirebaseError(error);
  }
}
