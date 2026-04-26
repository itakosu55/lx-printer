/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, type Mock } from 'vitest';
import { LXD02Printer, type PrinterStatus } from '../printer';

/**
 * `LXD02Printer` with private members exposed so tests can drive its internal
 * state machine directly (set `tx`, invoke `handleNotifications`, etc.).
 *
 * Typed as `any` because tests intentionally bypass TypeScript's privacy
 * modifiers — matching the `new LXD02Printer() as any` pattern from the
 * original tests.
 */
export type TestPrinter = any;

export interface MockTx {
  writeValueWithoutResponse: Mock;
}

/**
 * Create a printer with a mock TX characteristic already attached. The mock
 * resolves all writes immediately; tests can inspect `mockTx.writeValueWithoutResponse`
 * to assert what bytes were sent over the wire.
 */
export function createTestPrinter(options?: {
  onStatusChange?: (s: PrinterStatus) => void;
}): { printer: TestPrinter; mockTx: MockTx } {
  const printer = new LXD02Printer(options) as TestPrinter;
  const mockTx: MockTx = {
    writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
  };
  printer.tx = mockTx;
  return { printer, mockTx };
}

/**
 * Simulate a GATT notification by invoking the printer's notification handler
 * with the given wire bytes wrapped in the expected `Event`-shaped payload.
 */
export async function simulateNotification(
  printer: TestPrinter,
  bytes: ArrayLike<number>
): Promise<void> {
  const data =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(Array.from(bytes as ArrayLike<number>));
  await printer.handleNotifications({
    target: {
      value: {
        buffer: data.buffer,
        byteOffset: data.byteOffset,
        byteLength: data.byteLength,
      },
    },
  });
}
