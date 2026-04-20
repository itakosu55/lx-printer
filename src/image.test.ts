import { describe, it, expect } from 'vitest';
import { processImage } from './image';

describe('image', () => {
  it('should process raw data correctly', () => {
    // 2 lines of 384px = 96 bytes
    const rawData = new Uint8Array(96);
    rawData.fill(0xaa); // Dummy pattern

    const packets = processImage(rawData);

    // Should result in 1 data packet + 1 footer packet = 2 packets
    expect(packets.length).toBe(2);

    // Check data packet header
    expect(packets[0]![0]).toBe(0x55);
    expect(packets[0]![1]).toBe(0); // Seq MSB
    expect(packets[0]![2]).toBe(0); // Seq LSB
    expect(packets[0]![3]).toBe(0xaa);
    expect(packets[0]![98]).toBe(0xaa);
    expect(packets[0]![99]).toBe(0); // Padding

    // Check footer packet
    expect(packets[1]![0]).toBe(0x55);
    expect(packets[1]![1]).toBe(0); // Next Seq MSB (1)
    expect(packets[1]![2]).toBe(1); // Next Seq LSB (1)
    expect(packets[1]![3]).toBe(0); // Should be empty
  });

  it('should throw error for invalid raw data length', () => {
    const invalidData = new Uint8Array(10);
    expect(() => processImage(invalidData)).toThrow();
  });

  it('should process canvas elements correctly with dithering', () => {
    // 1. Mock the internal canvas context used in processImage
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (
      tagName: string,
      options?: ElementCreationOptions
    ) => {
      if (tagName.toLowerCase() === 'canvas') {
        const fakeCanvas = {
          width: 0,
          height: 0,
          getContext: (contextId: string) => {
            if (contextId === '2d') {
              return {
                fillStyle: '',
                fillRect: () => {},
                drawImage: () => {},
                getImageData: (x: number, y: number, w: number, h: number) => {
                  // Return a dummy all-black image data
                  const data = new Uint8ClampedArray(w * h * 4);
                  for (let i = 0; i < data.length; i += 4) {
                    data[i] = 0; // R
                    data[i + 1] = 0; // G
                    data[i + 2] = 0; // B
                    data[i + 3] = 255; // A
                  }
                  return { width: w, height: h, data };
                },
              };
            }
            return null;
          },
        } as unknown as HTMLCanvasElement;
        return fakeCanvas;
      }
      return originalCreateElement(tagName, options);
    };

    try {
      // 2. Create the input mock canvas
      const inputCanvas = {
        width: 192,
        height: 10,
      } as HTMLCanvasElement;

      // 3. Process the image
      // Target width is 384px. Scale = 384/192 = 2.
      // Target height should be 10 * 2 = 20.
      const packets = processImage(inputCanvas);

      // 20 lines -> 10 packets (2 lines per packet) + 1 footer = 11 packets
      expect(packets.length).toBe(11);

      // Verify the first packet structure
      expect(packets[0]![0]).toBe(0x55);
      expect(packets[0]![1]).toBe(0);
      expect(packets[0]![2]).toBe(0);

      // Since the mock returns an all-black image data, dithering should yield all black pixels.
      // Packed black pixel bits are 1s.
      // Therefore, the payload should be filled with 0xFF.
      expect(packets[0]![3]).toBe(0xff);

      // Verify footer packet
      const footer = packets[10]!;
      expect(footer[0]).toBe(0x55);
      expect(footer[1]).toBe(0); // MSB of 10
      expect(footer[2]).toBe(10); // LSB of 10
    } finally {
      document.createElement = originalCreateElement;
    }
  });
});
