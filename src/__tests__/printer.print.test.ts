import { describe, it, expect, vi } from 'vitest';
import { type PrinterStatus } from '../printer';
import { createTestPrinter, simulateNotification } from './helpers';

describe('LXD02Printer Print Completion', () => {
  it('should handle print completion (0x06) and send ACK', async () => {
    const { printer, mockTx } = createTestPrinter();

    const mockPrintResolver = vi.fn();
    printer.printResolver = mockPrintResolver;

    // Simulate Print Completion notification (length 0x0100 = 256)
    await simulateNotification(printer, [0x5a, 0x06, 0x01, 0x00]);

    // Verify it sent ACK
    expect(mockTx.writeValueWithoutResponse).toHaveBeenCalledOnce();
    const ackData = mockTx.writeValueWithoutResponse.mock
      .calls[0][0] as Uint8Array;
    expect(ackData[0]).toBe(0x5a);
    expect(ackData[1]).toBe(0x04);
    expect(ackData[2]).toBe(0x01); // MSB
    expect(ackData[3]).toBe(0x00); // LSB
    expect(ackData[4]).toBe(0x01); // ACK Flag

    // Verify printResolver was called and cleared
    expect(mockPrintResolver).toHaveBeenCalledOnce();
    expect(printer.printResolver).toBeUndefined();
  });
});

describe('LXD02Printer Concurrency & Defensive Copy', () => {
  it('should prevent concurrent printing and toggle isPrinting status', async () => {
    const statusChanges: PrinterStatus[] = [];
    const { printer } = createTestPrinter({
      onStatusChange: (s) => statusChanges.push(s),
    });

    // Start printing
    const printPromise = printer.print(new Uint8Array(48 * 2));

    // 1. Verify isPrinting is true and status notification was called
    expect(printer.status.isPrinting).toBe(true);
    expect(statusChanges.length).toBeGreaterThan(0);
    expect(statusChanges[statusChanges.length - 1].isPrinting).toBe(true);

    // 2. Try to start another print (should fail)
    const concurrent = printer.print(new Uint8Array(48));
    await expect(concurrent).rejects.toThrow('Printer is already printing');
    await expect(concurrent).rejects.toMatchObject({
      code: 'ALREADY_PRINTING',
    });

    // 3. Complete the first print (simulate completion notification)
    await simulateNotification(printer, [0x5a, 0x06, 0x00, 0x02]);

    await printPromise;

    // 4. Verify isPrinting is false
    expect(printer.status.isPrinting).toBe(false);
    expect(statusChanges[statusChanges.length - 1].isPrinting).toBe(false);
  });

  it('should provide a defensive copy to onStatusChange', async () => {
    let receivedStatus: PrinterStatus | null = null;
    const { printer } = createTestPrinter({
      onStatusChange: (s) => {
        receivedStatus = s;
        // Attempt to mutate the received status
        s.isPrinting = !s.isPrinting;
        s.battery = 999;
      },
    });

    // Trigger status update (0x5A 0x02 ...)
    await simulateNotification(
      printer,
      [0x5a, 0x02, 0x50, 0x00, 0x00, 0x00, 0x00, 0x03, 0x10, 0x00, 0x00, 0x00]
    );

    // Internal status should remain unaffected by the consumer's mutation
    expect(printer.status.battery).toBe(0x50);
    expect(printer.status.battery).not.toBe(receivedStatus!.battery);
    expect(printer.status.isPrinting).toBe(false);
  });

  it('should reset isPrinting even if onStatusChange callback throws', async () => {
    const { printer } = createTestPrinter({
      onStatusChange: () => {
        throw new Error('Consumer error');
      },
    });

    // Start printing
    const printPromise = printer.print(new Uint8Array(48));

    expect(printer.status.isPrinting).toBe(true);

    // Simulate completion
    await simulateNotification(printer, [0x5a, 0x06, 0x00, 0x01]);

    await printPromise;

    // isPrinting should be false despite the error in notifyStatus
    expect(printer.status.isPrinting).toBe(false);
  });
});
