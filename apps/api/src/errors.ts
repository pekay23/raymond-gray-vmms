export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly currentVersion?: number) {
    super(message);
  }
}

export function notFound(): never {
  throw new ApiError(404, 'NOT_FOUND', 'This record is not available in the selected site.');
}
