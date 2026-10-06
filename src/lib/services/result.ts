export type ServiceErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "conflict"
  | "already_reviewed"
  | "busy"
  | "calendar_error"
  | "calendar_required"
  | "access_required"
  | "storage_error"
  | "unknown";

export type ServiceResult<T = undefined> =
  | { ok: true; data: T; message: string }
  | { ok: false; code: ServiceErrorCode; error: string; fieldErrors?: Record<string, string> };

export function success<T>(data: T, message: string): ServiceResult<T> {
  return { ok: true, data, message };
}

export function failure<T = never>(
  code: ServiceErrorCode,
  error: string,
  fieldErrors?: Record<string, string>,
): ServiceResult<T> {
  return fieldErrors ? { ok: false, code, error, fieldErrors } : { ok: false, code, error };
}

export function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}
