export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code = 'BAD_REQUEST', message?: string, details?: unknown) =>
  new AppError(400, code, message ?? 'The request is invalid.', details);

export const unauthenticated = (code = 'UNAUTHENTICATED', message = 'Please log in.') =>
  new AppError(401, code, message);

export const forbidden = (
  code = 'FORBIDDEN',
  message = "You don't have permission to do that.",
  details?: unknown,
) => new AppError(403, code, message, details);

export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (code: string, message?: string, details?: unknown) =>
  new AppError(409, code, message ?? code, details);

export const gone = (code: string, message?: string) => new AppError(410, code, message ?? code);
