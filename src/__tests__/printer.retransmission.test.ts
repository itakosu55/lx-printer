import { describe, it, expect } from 'vitest';
import { createTestPrinter, simulateNotification } from './helpers';

describe('LXD02Printer Retransmission', () => {
  it('should update _resendRequestedIndex when receiving 0x05 notification', async () => {
    const { printer } = createTestPrinter();

    // Simulate notification: [0x5A, 0x05, 0x00, 0x75, ...]
    await simulateNotification(
      printer,
      [0x5a, 0x05, 0x00, 0x75, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    );

    // 0x0075 (117) -> index 116 (0x74)
    expect(printer._resendRequestedIndex).toBe(116);
  });

  it('should handle boundary cases (seq 0)', async () => {
    const { printer } = createTestPrinter();

    await simulateNotification(
      printer,
      [0x5a, 0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    );
    expect(printer._resendRequestedIndex).toBe(0);
  });
});
