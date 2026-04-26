/**
 * Stable identifiers for library-defined `LXPrinterError` instances.
 *
 * Prefer matching on `error.code` over `error.message` for errors confirmed
 * to be `LXPrinterError`s — messages may be reworded between releases, but
 * codes are part of the public API. Underlying browser/DOM errors may also be
 * thrown and will not necessarily have a `code`.
 */
export type LXErrorCode =
  // Environment
  | 'ENV_UNSUPPORTED'
  | 'BLUETOOTH_UNSUPPORTED'
  // Connection lifecycle
  | 'GATT_CONNECT_FAILED'
  | 'DISCOVERY_FAILED'
  | 'DISCOVERY_TIMEOUT'
  | 'NOT_CONNECTED'
  | 'DISCONNECTED'
  // Authentication
  | 'AUTH_FAILED'
  | 'AUTH_TIMEOUT'
  // State guards
  | 'ALREADY_PRINTING'
  | 'DENSITY_IN_PROGRESS'
  // Operation timeouts / failures
  | 'PRINT_TIMEOUT'
  | 'DENSITY_TIMEOUT'
  | 'DENSITY_FAILED'
  // Validation
  | 'INVALID_DENSITY'
  | 'INVALID_RAW_DATA'
  | 'INVALID_IMAGE'
  | 'INVALID_AUTH_BYTES'
  | 'INVALID_MAC_ADDRESS';

export class LXPrinterError extends Error {
  readonly code: LXErrorCode;

  constructor(
    code: LXErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'LXPrinterError';
    this.code = code;
    // Restore prototype chain when transpiled to ES5 targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isLXPrinterError(value: unknown): value is LXPrinterError {
  return value instanceof LXPrinterError;
}
