import { describe, it, expect } from 'vitest';
import { calculateCrc16Xmodem, calculateAuthResponse } from './auth';
import { LXPrinterError } from './errors';

describe('auth', () => {
  it('should calculate CRC-16/XMODEM correctly', () => {
    const data = new TextEncoder().encode('123456789');
    const crc = calculateCrc16Xmodem(data);
    expect(crc).toBe(0x31c3);
  });

  it('should calculate auth response correctly', () => {
    const authBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const mac = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);

    const response = calculateAuthResponse(authBytes, mac);

    expect(response.length).toBe(10);
    // Manual check for index 0:
    // dataToCrc = [0x00, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]
    const expectedCrc0 = calculateCrc16Xmodem(
      new Uint8Array([0x00, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])
    );
    expect(response[0]).toBe((expectedCrc0 >> 8) & 0xff);
  });

  it('should throw LXPrinterError for invalid authBytes length', () => {
    const badAuth = new Uint8Array(9);
    const mac = new Uint8Array(6);
    try {
      calculateAuthResponse(badAuth, mac);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LXPrinterError);
      expect((err as LXPrinterError).code).toBe('INVALID_AUTH_BYTES');
    }
  });

  it('should throw LXPrinterError for invalid macAddress length', () => {
    const auth = new Uint8Array(10);
    const badMac = new Uint8Array(5);
    try {
      calculateAuthResponse(auth, badMac);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LXPrinterError);
      expect((err as LXPrinterError).code).toBe('INVALID_MAC_ADDRESS');
    }
  });
});
