import { describe, it, expect, vi } from 'vitest';
import { LXD02Printer } from './printer';

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
});
