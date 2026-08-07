declare const brand: unique symbol;

/**
 * Nominal typing helper (SDD 24.1).
 *
 * `Brand<string, 'OrderId'>` is not assignable to `Brand<string, 'VendorId'>`,
 * which makes an entire class of identifier-mixup bugs a compile error instead
 * of a production incident.
 */
export type Brand<T, TBrand extends string> = T & { readonly [brand]: TBrand };

export type Uuid = Brand<string, 'Uuid'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): value is Uuid => UUID_PATTERN.test(value);

/** Narrows a string to a branded id, throwing if it is not a well-formed UUID. */
export const toUuid = (value: string): Uuid => {
  if (!isUuid(value)) {
    throw new TypeError(`Not a valid UUID: "${value}"`);
  }
  return value;
};

/**
 * Creates a branded identifier type plus its guard/constructor pair.
 * Business modules use this to declare their own id types without repeating the
 * validation logic.
 */
export const createIdType = <TBrand extends string>(
  name: TBrand,
): {
  readonly is: (value: string) => value is Brand<string, TBrand>;
  readonly from: (value: string) => Brand<string, TBrand>;
} => ({
  is: (value: string): value is Brand<string, TBrand> => isUuid(value),
  from: (value: string): Brand<string, TBrand> => {
    if (!isUuid(value)) {
      throw new TypeError(`Not a valid ${name}: "${value}"`);
    }
    return value as Brand<string, TBrand>;
  },
});
