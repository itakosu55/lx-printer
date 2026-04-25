import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LXD02Printer, PrinterStatus } from './printer';

describe('LXD02Printer Authentication & Print Completion', () => {
  it('should complete authentication sequence correctly', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const printer = new LXD02Printer() as any;

    const mockTx = {
      writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
    };
    printer.tx = mockTx;

    const authPromise = new Promise<boolean>((resolve) => {
      printer.authResolver = resolve;
    });

    // 1. Simulate Stage 1: Received MAC
    const macData = [
      0x5a, 0x01, 0x00, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
    ];
    const mockValue1 = new Uint8Array(macData);
    await printer.handleNotifications({
      target: {
        value: {
          buffer: mockValue1.buffer,
          byteOffset: 0,
          byteLength: mockValue1.length,
        },
      },
    });

    // Verify it sent Challenge (0x0A)
    expect(mockTx.writeValueWithoutResponse).toHaveBeenCalled();
    const lastCallData1 = mockTx.writeValueWithoutResponse.mock
      .calls[0][0] as Uint8Array;
    expect(lastCallData1[0]).toBe(0x5a);
    expect(lastCallData1[1]).toBe(0x0a);

    // 2. Simulate Stage 2: Prompt for response
    const mockValue2 = new Uint8Array([0x5a, 0x0a, 0x00, 0x00]);
    await printer.handleNotifications({
      target: {
        value: {
          buffer: mockValue2.buffer,
          byteOffset: 0,
          byteLength: mockValue2.length,
        },
      },
    });

    // Verify it sent Response (0x0B)
    const lastCallData2 = mockTx.writeValueWithoutResponse.mock
      .calls[1][0] as Uint8Array;
    expect(lastCallData2[0]).toBe(0x5a);
    expect(lastCallData2[1]).toBe(0x0b);

    // 3. Simulate Stage 3: Result
    const mockValue3 = new Uint8Array([0x5a, 0x0b, 0x01, 0x00]);
    await printer.handleNotifications({
      target: {
        value: {
          buffer: mockValue3.buffer,
          byteOffset: 0,
          byteLength: mockValue3.length,
        },
      },
    });

    const isSuccess = await authPromise;
    expect(isSuccess).toBe(true);
    expect(printer.authResolver).toBeUndefined();
  });

  it('should handle print completion (0x06) and send ACK', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const printer = new LXD02Printer() as any;

    const mockTx = {
      writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
    };
    printer.tx = mockTx;

    const mockPrintResolver = vi.fn();
    printer.printResolver = mockPrintResolver;

    // Simulate Print Completion notification
    // e.g. length of 0x0100 (256)
    const mockValue = new Uint8Array([0x5a, 0x06, 0x01, 0x00]);
    await printer.handleNotifications({
      target: {
        value: {
          buffer: mockValue.buffer,
          byteOffset: 0,
          byteLength: mockValue.length,
        },
      },
    });

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

  describe('setDensity', () => {
    it('should send density command and resolve on ACK', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const printer = new LXD02Printer() as any;
      const mockTx = {
        writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
      };
      printer.tx = mockTx;

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
      const mockValue = new Uint8Array([0x5a, 0x0c, 0x06, 0x3f, 0x01]);
      await printer.handleNotifications({
        target: {
          value: {
            buffer: mockValue.buffer,
            byteOffset: 0,
            byteLength: mockValue.length,
          },
        },
      });

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
    });

    it('should throw error if density setting is already in progress', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const printer = new LXD02Printer() as any;
      printer.tx = {
        writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
      };

      const p1 = printer.setDensity(4);
      await expect(printer.setDensity(5)).rejects.toThrow(
        'Density setting is already in progress'
      );

      // Clean up by simulating ACK
      const mockValue = new Uint8Array([0x5a, 0x0c, 0x03]);
      await printer.handleNotifications({
        target: {
          value: {
            buffer: mockValue.buffer,
            byteOffset: 0,
            byteLength: mockValue.length,
          },
        },
      });
      await p1;
    });

    it('should skip command if density is already set', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const printer = new LXD02Printer() as any;
      const mockTx = { writeValueWithoutResponse: vi.fn() };
      printer.tx = mockTx;
      printer.status = { isConnected: true, density: 4, isPrinting: false };

      await printer.setDensity(4);
      expect(mockTx.writeValueWithoutResponse).not.toHaveBeenCalled();
    });
  });

  describe('Concurrency & Defensive Copy', () => {
    it('should prevent concurrent printing and toggle isPrinting status', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const printer = new LXD02Printer() as any;
      const mockTx = {
        writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
      };
      printer.tx = mockTx;

      const statusChanges: PrinterStatus[] = [];
      printer.onStatusChange = (s: PrinterStatus) => statusChanges.push(s);

      // Start printing
      const printPromise = printer.print(new Uint8Array(48 * 2));

      // 1. Verify isPrinting is true and status notification was called
      expect(printer.status.isPrinting).toBe(true);
      expect(statusChanges.length).toBeGreaterThan(0);
      expect(statusChanges[statusChanges.length - 1].isPrinting).toBe(true);

      // 2. Try to start another print (should fail)
      await expect(printer.print(new Uint8Array(48))).rejects.toThrow(
        'Printer is already printing'
      );

      // 3. Complete the first print (simulate completion notification)
      const mockValue = new Uint8Array([0x5a, 0x06, 0x00, 0x02]);
      await printer.handleNotifications({
        target: {
          value: {
            buffer: mockValue.buffer,
            byteOffset: 0,
            byteLength: mockValue.length,
          },
        },
      });

      await printPromise;

      // 4. Verify isPrinting is false
      expect(printer.status.isPrinting).toBe(false);
      expect(statusChanges[statusChanges.length - 1].isPrinting).toBe(false);
    });

    it('should provide a defensive copy to onStatusChange', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const printer = new LXD02Printer() as any;
      let receivedStatus: PrinterStatus | null = null;

      printer.onStatusChange = (s: PrinterStatus) => {
        receivedStatus = s;
        // Attempt to mutate the received status
        s.isPrinting = !s.isPrinting;
        s.battery = 999;
      };

      // Trigger status update (0x5A 0x02 ...)
      const mockValue = new Uint8Array([
        0x5a, 0x02, 0x50, 0x00, 0x00, 0x00, 0x00, 0x03, 0x10, 0x00, 0x00, 0x00,
      ]);
      await printer.handleNotifications({
        target: {
          value: {
            buffer: mockValue.buffer,
            byteOffset: 0,
            byteLength: mockValue.length,
          },
        },
      });

      // Internal status should remain unaffected by the consumer's mutation
      expect(printer.status.battery).toBe(0x50);
      expect(printer.status.battery).not.toBe(receivedStatus!.battery);
      expect(printer.status.isPrinting).toBe(false);
    });

    it('should reset isPrinting even if onStatusChange callback throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const printer = new LXD02Printer() as any;
      printer.tx = {
        writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
      };

      // Setup a throwing callback
      printer.onStatusChange = () => {
        throw new Error('Consumer error');
      };

      // Start printing
      const printPromise = printer.print(new Uint8Array(48));

      expect(printer.status.isPrinting).toBe(true);

      // Simulate completion
      const mockValue = new Uint8Array([0x5a, 0x06, 0x00, 0x01]);
      await printer.handleNotifications({
        target: {
          value: {
            buffer: mockValue.buffer,
            byteOffset: 0,
            byteLength: mockValue.length,
          },
        },
      });

      await printPromise;

      // isPrinting should be false despite the error in notifyStatus
      expect(printer.status.isPrinting).toBe(false);
    });
  });

  describe('Disconnection', () => {
    it('should update isConnected to false on handleDisconnect', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const printer = new LXD02Printer() as any;
      let lastStatus: PrinterStatus | null = null;
      printer.onStatusChange = (s: PrinterStatus) => {
        lastStatus = s;
      };

      printer.status = { isConnected: true, isPrinting: true };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      printer.tx = {} as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      printer.rx = {} as any;

      printer.handleDisconnect();

      expect(printer.status.isConnected).toBe(false);
      expect(printer.status.isPrinting).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((lastStatus as any)?.isConnected).toBe(false);
      expect(printer.tx).toBeNull();
      expect(printer.rx).toBeNull();
    });

    it('should register and unregister gattserverdisconnected listener', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global.navigator as any).bluetooth = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global.navigator as any).bluetooth = originalBluetooth;
    });

    it('should reject pending operations on disconnect', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const printer = new LXD02Printer() as any;
      printer.tx = {
        writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
      };
      printer.status = { isConnected: true, isPrinting: false };

      const printPromise = printer.print(new Uint8Array(48));

      printer.handleDisconnect();

      await expect(printPromise).rejects.toThrow('Printer disconnected');
    });
  });

  describe('Connection Robustness (Retries & Timeouts)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let originalBluetooth: any;

    beforeEach(() => {
      originalBluetooth = global.navigator.bluetooth;
      vi.useFakeTimers();
    });

    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global.navigator as any).bluetooth = {
        requestDevice: vi.fn().mockResolvedValue(mockDevice),
      };

      const printer = new LXD02Printer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (printer as any).authenticate = vi.fn().mockResolvedValue(undefined);

      const connectPromise = printer.connect();

      // Handle stabilization delay (300ms) and retry delay (1500ms)
      await vi.runAllTimersAsync();

      await connectPromise;

      expect(mockServer.getPrimaryService).toHaveBeenCalledTimes(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global.navigator as any).bluetooth = {
        requestDevice: vi.fn().mockResolvedValue(mockDevice),
      };

      const printer = new LXD02Printer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (printer as any).authenticate = vi.fn().mockResolvedValue(undefined);

      const connectPromise = printer.connect();

      // Fast-forward to trigger 5s timeout and 1.5s backoff
      await vi.runAllTimersAsync();

      await connectPromise;

      expect(mockServer.getPrimaryService).toHaveBeenCalledTimes(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
});
