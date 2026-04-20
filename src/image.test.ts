import { describe, it, expect } from "vitest";
import { processImage } from "./image";

describe("image", () => {
  it("should process raw data correctly", () => {
    // 2 lines of 384px = 96 bytes
    const rawData = new Uint8Array(96);
    rawData.fill(0xAA); // Dummy pattern

    const packets = processImage(rawData);

    // Should result in 1 data packet + 1 footer packet = 2 packets
    expect(packets.length).toBe(2);
    
    // Check data packet header
    expect(packets[0]![0]).toBe(0x55);
    expect(packets[0]![1]).toBe(0); // Seq MSB
    expect(packets[0]![2]).toBe(0); // Seq LSB
    expect(packets[0]![3]).toBe(0xAA);
    expect(packets[0]![98]).toBe(0xAA);
    expect(packets[0]![99]).toBe(0); // Padding

    // Check footer packet
    expect(packets[1]![0]).toBe(0x55);
    expect(packets[1]![1]).toBe(0); // Next Seq MSB (1)
    expect(packets[1]![2]).toBe(1); // Next Seq LSB (1)
    expect(packets[1]![3]).toBe(0); // Should be empty
  });

  it("should throw error for invalid raw data length", () => {
    const invalidData = new Uint8Array(10);
    expect(() => processImage(invalidData)).toThrow();
  });
});
