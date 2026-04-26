import { describe, it, expect } from 'vitest';
import { createTestPrinter, simulateNotification } from './helpers';

describe('LXD02Printer Authentication', () => {
  it('should complete authentication sequence correctly', async () => {
    const { printer, mockTx } = createTestPrinter();

    const authPromise = new Promise<boolean>((resolve) => {
      printer.authResolver = resolve;
    });

    // 1. Simulate Stage 1: Received MAC
    await simulateNotification(
      printer,
      [0x5a, 0x01, 0x00, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]
    );

    // Verify it sent Challenge (0x0A)
    expect(mockTx.writeValueWithoutResponse).toHaveBeenCalled();
    const lastCallData1 = mockTx.writeValueWithoutResponse.mock
      .calls[0][0] as Uint8Array;
    expect(lastCallData1[0]).toBe(0x5a);
    expect(lastCallData1[1]).toBe(0x0a);

    // 2. Simulate Stage 2: Prompt for response
    await simulateNotification(printer, [0x5a, 0x0a, 0x00, 0x00]);

    // Verify it sent Response (0x0B)
    const lastCallData2 = mockTx.writeValueWithoutResponse.mock
      .calls[1][0] as Uint8Array;
    expect(lastCallData2[0]).toBe(0x5a);
    expect(lastCallData2[1]).toBe(0x0b);

    // 3. Simulate Stage 3: Result
    await simulateNotification(printer, [0x5a, 0x0b, 0x01, 0x00]);

    const isSuccess = await authPromise;
    expect(isSuccess).toBe(true);
    expect(printer.authResolver).toBeUndefined();
  });
});
