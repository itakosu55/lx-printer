import { describe, it, expect, vi } from 'vitest';
import { LXD02Printer } from '../printer';
import { LXPrinterError } from '../errors';
import { createTestPrinter, simulateNotification } from './helpers';

describe('LXD02Printer setDensity', () => {
  it('should send density command and resolve on ACK', async () => {
    const { printer, mockTx } = createTestPrinter();

    // Initialize status to verify cache update
    printer.status = {
      isConnected: true,
      battery: 100,
      isOutOfPaper: false,
      isCharging: false,
      isOverheat: false,
      isLowBattery: false,
      density: 4,
      voltage: 4000,
      isPrinting: false,
    };

    const densityPromise = printer.setDensity(7);

    // Simulate ACK (5a 0c 06 ...)
    await simulateNotification(printer, [0x5a, 0x0c, 0x06, 0x3f, 0x01]);

    await expect(densityPromise).resolves.toBeUndefined();
    expect(mockTx.writeValueWithoutResponse).toHaveBeenCalledWith(
      new Uint8Array([0x5a, 0x0c, 0x06])
    );
    // Cache should be updated to 7
    expect(printer.status?.density).toBe(7);
  });

  it('should throw error for invalid density values', async () => {
    const printer = new LXD02Printer();
    await expect(printer.setDensity(0)).rejects.toThrow(
      'Density must be between 1 and 7'
    );
    await expect(printer.setDensity(8)).rejects.toThrow(
      'Density must be between 1 and 7'
    );
    await expect(printer.setDensity(2.5)).rejects.toThrow(
      'Density must be an integer between 1 and 7'
    );

    // Verify the new error API: instanceof + code
    await expect(printer.setDensity(0)).rejects.toMatchObject({
      name: 'LXPrinterError',
      code: 'INVALID_DENSITY',
    });
    await expect(printer.setDensity(0)).rejects.toBeInstanceOf(LXPrinterError);
  });

  it('should throw error if density setting is already in progress', async () => {
    const { printer } = createTestPrinter();

    const p1 = printer.setDensity(4);
    const inProgress = printer.setDensity(5);
    await expect(inProgress).rejects.toThrow(
      'Density setting is already in progress'
    );
    await expect(inProgress).rejects.toMatchObject({
      code: 'DENSITY_IN_PROGRESS',
    });

    // Clean up by simulating ACK
    await simulateNotification(printer, [0x5a, 0x0c, 0x03]);
    await p1;
  });

  it('should skip command if density is already set', async () => {
    const { printer, mockTx } = createTestPrinter();
    // Replace mockTx with a non-resolving spy to verify it isn't called
    mockTx.writeValueWithoutResponse = vi.fn();
    printer.tx = mockTx;
    printer.status = { isConnected: true, density: 4, isPrinting: false };

    await printer.setDensity(4);
    expect(mockTx.writeValueWithoutResponse).not.toHaveBeenCalled();
  });
});
