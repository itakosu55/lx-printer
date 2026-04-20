import { describe, it, expect, vi } from "vitest";
import { LXD02Printer } from "./printer";

describe("LXD02Printer Retransmission", () => {
  it("should update _resendRequestedIndex when receiving 0x05 notification", async () => {
    const printer = new LXD02Printer() as any;
    
    // Simulate notification: [0x5A, 0x05, 0x00, 0x75, ...]
    const mockValue = new Uint8Array([0x5A, 0x05, 0x00, 0x75, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const mockEvent = {
      target: {
        value: {
          buffer: mockValue.buffer
        }
      }
    };

    await printer.handleNotifications(mockEvent);
    
    // 0x0075 (117) -> index 116 (0x74)
    expect(printer._resendRequestedIndex).toBe(116);
  });

  it("should handle boundary cases (seq 0)", async () => {
    const printer = new LXD02Printer() as any;
    const mockValue = new Uint8Array([0x5A, 0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const mockEvent = { target: { value: { buffer: mockValue.buffer } } };

    await printer.handleNotifications(mockEvent);
    expect(printer._resendRequestedIndex).toBe(0);
  });
});
