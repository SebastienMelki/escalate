/**
 * Lightweight Result type for explicit error handling.
 *
 * Use for operations that can fail in expected ways (config loading, adapter operations).
 * Do NOT use for programming errors (those should throw).
 */
export type Result<T, E> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

/** Create a successful Result. */
export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

/** Create a failed Result. */
export function err<E>(error: E): Result<never, E> {
  return { success: false, error };
}

/** Type guard: check if Result is successful. */
export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly success: true; readonly data: T } {
  return result.success;
}

/** Type guard: check if Result is a failure. */
export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly success: false; readonly error: E } {
  return !result.success;
}

/** Extract the data from a Result, or return a fallback value. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.success ? result.data : fallback;
}
