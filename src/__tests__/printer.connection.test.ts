/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LXD02Printer, type PrinterStatus } from '../printer';
import { LXPrinterError } from '../errors';
import { createTestPrinter } from './helpers';

describe('LXD02Printer Disconnection', () => {
  it('should update isConnected to false on handleDisconnect', async () => {
    let lastStatus: PrinterStatus | null = null;
    const { printer } = createTestPrinter({
      onStatusChange: (s) => {
        lastStatus = s;
      },
    });

    printer.status = { isConnected: true, isPrinting: true };
    printer.rx = {} as any;

    printer.handleDisconnect();

    expect(printer.status.isConnected).toBe(false);
    expect(printer.status.isPrinting).toBe(false);
    expect((lastStatus as any)?.isConnected).toBe(false);
    expect(printer.tx).toBeNull();
    expect(printer.rx).toBeNull();
  });

  it('should register and unregister gattserverdisconnected listener', async () => {
    const printer = new LXD02Printer() as any;
    const mockServer = {
      getPrimaryService: vi.fn().mockResolvedValue({
        getCharacteristic: vi.fn().mockResolvedValue({
          startNotifications: vi.fn().mockResolvedValue(undefined),
          stopNotifications: vi.fn().mockResolvedValue(undefined),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
      }),
    };
    const mockDevice = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      gatt: { connect: vi.fn().mockResolvedValue(mockServer) },
    };

    // Mock navigator.bluetooth
    const originalBluetooth = global.navigator.bluetooth;
    (global.navigator as any).bluetooth = {
      requestDevice: vi.fn().mockResolvedValue(mockDevice as any),
    };

    // Mock authenticate to prevent full connection flow
    printer.authenticate = vi.fn().mockResolvedValue(undefined);

    await printer.connect();

    expect(mockDevice.addEventListener).toHaveBeenCalledWith(
      'gattserverdisconnected',
      expect.any(Function)
    );

    const listener = mockDevice.addEventListener.mock.calls[0][1];
    printer.boundHandleDisconnect = listener;
    printer.device = mockDevice;

    printer.disconnect();

    expect(mockDevice.removeEventListener).toHaveBeenCalledWith(
      'gattserverdisconnected',
      listener
    );

    // Restore
    (global.navigator as any).bluetooth = originalBluetooth;
  });

  it('should reject pending operations on disconnect', async () => {
    const { printer } = createTestPrinter();
    printer.status = { isConnected: true, isPrinting: false };

    const printPromise = printer.print(new Uint8Array(48));

    printer.handleDisconnect();

    await expect(printPromise).rejects.toThrow('Printer disconnected');
    await expect(printPromise).rejects.toBeInstanceOf(LXPrinterError);
    await expect(printPromise).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });
  });
});

describe('LXD02Printer Connection Robustness (Retries & Timeouts)', () => {
  let originalBluetooth: any;

  beforeEach(() => {
    originalBluetooth = global.navigator.bluetooth;
    vi.useFakeTimers();
  });

  afterEach(() => {
    (global.navigator as any).bluetooth = originalBluetooth;
    vi.useRealTimers();
  });

  it('should retry and succeed if discovery fails initially', async () => {
    const mockCharacteristic = {
      startNotifications: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
    };
    const mockService = {
      getCharacteristic: vi.fn().mockResolvedValue(mockCharacteristic),
    };
    const mockServer = {
      connect: vi.fn().mockImplementation(async () => mockServer),
      disconnect: vi.fn(),
      getPrimaryService: vi
        .fn()
        .mockImplementationOnce(async () => {
          throw new Error('GATT Error');
        })
        .mockResolvedValueOnce(mockService),
      connected: true,
    };

    const mockDevice = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      gatt: mockServer,
    };

    (global.navigator as any).bluetooth = {
      requestDevice: vi.fn().mockResolvedValue(mockDevice),
    };

    const printer = new LXD02Printer();
    (printer as any).authenticate = vi.fn().mockResolvedValue(undefined);

    const connectPromise = printer.connect();

    // Handle stabilization delay (300ms) and retry delay (1500ms)
    await vi.runAllTimersAsync();

    await connectPromise;

    expect(mockServer.getPrimaryService).toHaveBeenCalledTimes(2);
    expect((printer as any).status.isConnected).toBe(true);
  });

  it('should retry and succeed if discovery hangs (timeout)', async () => {
    const mockCharacteristic = {
      startNotifications: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
    };
    const mockService = {
      getCharacteristic: vi.fn().mockResolvedValue(mockCharacteristic),
    };
    const mockServer = {
      connect: vi.fn().mockImplementation(async () => mockServer),
      disconnect: vi.fn(),
      getPrimaryService: vi
        .fn()
        // First call hangs
        .mockReturnValueOnce(new Promise(() => {}))
        // Second call succeeds
        .mockResolvedValueOnce(mockService),
      connected: true,
    };
    const mockDevice = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      gatt: mockServer,
    };

    (global.navigator as any).bluetooth = {
      requestDevice: vi.fn().mockResolvedValue(mockDevice),
    };

    const printer = new LXD02Printer();
    (printer as any).authenticate = vi.fn().mockResolvedValue(undefined);

    const connectPromise = printer.connect();

    // Fast-forward to trigger 5s timeout and 1.5s backoff
    await vi.runAllTimersAsync();

    await connectPromise;

    expect(mockServer.getPrimaryService).toHaveBeenCalledTimes(2);
    expect((printer as any).status.isConnected).toBe(true);
  });

  it('should fail after maximum retry attempts', async () => {
    const mockServer = {
      connect: vi.fn().mockImplementation(async () => mockServer),
      disconnect: vi.fn(),
      getPrimaryService: vi.fn().mockImplementation(async () => {
        throw new Error('Persistent Error');
      }),
      connected: true,
    };

    const mockDevice = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      gatt: mockServer,
    };

    (global.navigator as any).bluetooth = {
      requestDevice: vi.fn().mockResolvedValue(mockDevice),
    };

    const printer = new LXD02Printer();

    const connectPromise = printer.connect();

    // Attach a catch handler immediately to prevent Unhandled Rejection errors
    // in some test environments. We'll verify the error later.
    const caughtErrorPromise = connectPromise.catch((e) => e);

    // We need to advance timers repeatedly to go through the retry loop
    for (let i = 0; i < 3; i++) {
      await vi.runAllTimersAsync();
    }

    const error = await caughtErrorPromise;
    expect(error).toBeDefined();
    expect(error.message).toBe('Persistent Error');
    expect(mockServer.getPrimaryService).toHaveBeenCalledTimes(3);
  });
});
