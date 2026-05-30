import { describe, it, expect } from 'vitest';
import { PrintData } from './image';
import { LXPrinterError } from './errors';

describe('image', () => {
  it('should process raw data correctly', () => {
    // 2 lines of 384px = 96 bytes
    const rawData = new Uint8Array(96);
    rawData.fill(0xaa); // Dummy pattern

    const printData = PrintData.fromRaw(rawData);
    const packets = printData.getPackets();

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
    expect(() => PrintData.fromRaw(invalidData)).toThrow(LXPrinterError);
    try {
      PrintData.fromRaw(invalidData);
    } catch (err) {
      expect(err).toBeInstanceOf(LXPrinterError);
      expect((err as LXPrinterError).code).toBe('INVALID_RAW_DATA');
    }
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
      const printData = PrintData.fromImage(inputCanvas);
      const packets = printData.getPackets();

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

  it('should process canvas elements correctly with threshold algorithm', () => {
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
                  const data = new Uint8ClampedArray(w * h * 4);
                  // Fill first 192 pixels with 100 (below threshold 150) -> should be black (1)
                  // Fill remaining 192 pixels with 200 (above threshold 150) -> should be white (0)
                  for (let i = 0; i < data.length; i += 4) {
                    const pixelIdx = (i / 4) % w;
                    const val = pixelIdx < 192 ? 100 : 200;
                    data[i] = val; // R
                    data[i + 1] = val; // G
                    data[i + 2] = val; // B
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
      const inputCanvas = {
        width: 384,
        height: 2,
      } as HTMLCanvasElement;

      // 1. Check default threshold (128)
      // pixels 0-191 have val 100 (below 128) -> black (1)
      // pixels 192-383 have val 200 (above 128) -> white (0)
      const data1 = PrintData.fromImage(inputCanvas, {
        algorithm: 'threshold',
      });
      const packets1 = data1.getPackets();
      // 2 lines -> 1 packet + 1 footer = 2 packets
      expect(packets1.length).toBe(2);

      const payload1 = packets1[0]!.subarray(3, 3 + 48); // First line (48 bytes = 384 bits)
      // The first 192 bits (24 bytes) should be black (all bits 1, i.e., 0xFF)
      // The next 192 bits (24 bytes) should be white (all bits 0, i.e., 0x00)
      for (let i = 0; i < 24; i++) {
        expect(payload1[i]).toBe(0xff);
      }
      for (let i = 24; i < 48; i++) {
        expect(payload1[i]).toBe(0x00);
      }

      // 2. Check custom threshold (80)
      // pixels 0-191 have val 100 (above 80) -> white (0)
      // pixels 192-383 have val 200 (above 80) -> white (0)
      // So all pixels should be white (0x00)
      const data2 = PrintData.fromImage(inputCanvas, {
        algorithm: 'threshold',
        threshold: 80,
      });
      const packets2 = data2.getPackets();
      const payload2 = packets2[0]!.subarray(3, 3 + 48);
      for (let i = 0; i < 48; i++) {
        expect(payload2[i]).toBe(0x00);
      }

      // 3. Check custom threshold (220)
      // pixels 0-191 have val 100 (below 220) -> black (1)
      // pixels 192-383 have val 200 (below 220) -> black (1)
      // So all pixels should be black (0xFF)
      const data3 = PrintData.fromImage(inputCanvas, {
        algorithm: 'threshold',
        threshold: 220,
      });
      const packets3 = data3.getPackets();
      const payload3 = packets3[0]!.subarray(3, 3 + 48);
      for (let i = 0; i < 48; i++) {
        expect(payload3[i]).toBe(0xff);
      }
    } finally {
      document.createElement = originalCreateElement;
    }
  });

  it('should throw error for invalid threshold values', () => {
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (
      tagName: string,
      options?: ElementCreationOptions
    ) => {
      if (tagName.toLowerCase() === 'canvas') {
        const fakeCanvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '',
            fillRect: () => {},
            drawImage: () => {},
            getImageData: (x: number, y: number, w: number, h: number) => {
              return {
                width: w,
                height: h,
                data: new Uint8ClampedArray(w * h * 4),
              };
            },
          }),
        } as unknown as HTMLCanvasElement;
        return fakeCanvas;
      }
      return originalCreateElement(tagName, options);
    };

    try {
      const inputCanvas = { width: 384, height: 10 } as HTMLCanvasElement;

      const invalidValues = [
        -5,
        256,
        NaN,
        Infinity,
        -Infinity,
        128.5,
        '128' as unknown as number,
      ];
      for (const val of invalidValues) {
        expect(() =>
          PrintData.fromImage(inputCanvas, {
            algorithm: 'threshold',
            threshold: val,
          })
        ).toThrow(LXPrinterError);
      }
    } finally {
      document.createElement = originalCreateElement;
    }
  });

  it('should return a defensive copy from getPackets', () => {
    const rawData = new Uint8Array(96);
    rawData.fill(0xaa);
    const printData = PrintData.fromRaw(rawData);

    const packets1 = printData.getPackets();
    const packets2 = printData.getPackets();

    // Verify it is a new array
    expect(packets1).not.toBe(packets2);
    // Verify the Uint8Array elements are distinct objects
    expect(packets1[0]).not.toBe(packets2[0]);

    // Modify a value in packets1
    packets1[0]![0] = 0x99;
    packets1[0]![3] = 0x88;

    // Verify packets2 was not affected (still has original values)
    expect(packets2[0]![0]).toBe(0x55);
    expect(packets2[0]![3]).toBe(0xaa);
  });
});
