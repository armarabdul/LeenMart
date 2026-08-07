/**
 * A discriminated result type for operations that can fail for *business*
 * reasons (SDD 17.2).
 *
 * Exceptions stay reserved for genuinely exceptional conditions. Expected
 * failures — "preorder sold out", "address not serviceable" — are returned, so
 * the compiler forces the caller to handle them.
 */
export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

/** Applies `fn` to a successful value, leaving a failure untouched. */
export const mapResult = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result;

/** Applies `fn` to a failure, leaving a success untouched. */
export const mapError = <T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> =>
  result.ok ? result : err(fn(result.error));

/**
 * Unwraps a successful value or throws. Only for call sites that have already
 * proven the result is Ok (tests, or after an `isOk` guard).
 */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (!result.ok) {
    throw new Error(`Called unwrap() on an Err result: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

/** Unwraps a successful value or returns the supplied fallback. */
export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;
