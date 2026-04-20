/**
 * Image processing utilities for LX-D02 thermal printer
 */

/**
 * Process an image and convert it into 100-byte packets for the LX-D02 printer.
 */
export function processImage(data: HTMLImageElement | HTMLCanvasElement | Uint8Array): Uint8Array[] {
  let binaryData: Uint8Array;
  let lineCount: number;

  if (data instanceof Uint8Array) {
    binaryData = data;
    if (binaryData.length % 48 !== 0) {
      throw new Error("Raw data length must be a multiple of 48 (384px / 8)");
    }
    lineCount = binaryData.length / 48;
  } else {
    // Process image/canvas to 384px wide dithered 1-bit data
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not get canvas context");

    const sourceWidth = data instanceof HTMLImageElement ? data.naturalWidth : data.width;
    const sourceHeight = data instanceof HTMLImageElement ? data.naturalHeight : data.height;
    
    if (sourceWidth === 0 || sourceHeight === 0) {
      throw new Error("Invalid image dimensions: source has 0 width or height. Ensure the image is fully loaded.");
    }

    // Scale to 384px width
    const targetWidth = 384;
    const scale = targetWidth / sourceWidth;
    const targetHeight = Math.round(sourceHeight * scale);

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(data, 0, 0, targetWidth, targetHeight);

    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    binaryData = applyDitheringAndPack(imageData);
    lineCount = targetHeight;
  }

  // Split into 96-byte blocks (2 lines) and create 100-byte packets
  const packets: Uint8Array[] = [];
  const totalBlocks = Math.ceil(lineCount / 2);
  
  for (let i = 0; i < totalBlocks; i++) {
    const packet = new Uint8Array(100);
    packet[0] = 0x55; // Line header
    packet[1] = (i >> 8) & 0xff; // Seq MSB
    packet[2] = i & 0xff; // Seq LSB
    
    const startOffset = i * 96;
    const endOffset = Math.min(startOffset + 96, binaryData.length);
    packet.set(binaryData.subarray(startOffset, endOffset), 3);
    
    // Byte[99] is 0x00 padding (already 0 by initialization)
    packets.push(packet);
  }

  // Footer packet
  const footer = new Uint8Array(100);
  footer[0] = 0x55;
  footer[1] = (totalBlocks >> 8) & 0xff;
  footer[2] = totalBlocks & 0xff;
  packets.push(footer);

  return packets;
}

/**
 * Apply Floyd-Steinberg dithering with luminance correction and pack into 1-bit per pixel
 */
function applyDitheringAndPack(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData;
  const gray = new Float32Array(width * height);

  // 1. Grayscale with luminance correction
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    // Y = 0.299R + 0.587G + 0.114B
    gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 2. Floyd-Steinberg Dithering
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = gray[idx]!;
      const newPixel = oldPixel < 128 ? 0 : 255;
      result[idx] = oldPixel < 128 ? 1 : 0; // 1 = Black, 0 = White for printer

      const error = oldPixel - newPixel;
      
      if (x + 1 < width) gray[idx + 1] += error * 7 / 16;
      if (y + 1 < height) {
        if (x > 0) gray[idx + width - 1] += error * 3 / 16;
        gray[idx + width] += error * 5 / 16;
        if (x + 1 < width) gray[idx + width + 1] += error * 1 / 16;
      }
    }
  }

  // 3. Pack into bits (White=0, Black=1)
  // Each line is 384px = 48 bytes
  const packed = new Uint8Array(height * 48);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (result[y * width + x]) {
        const byteIdx = y * 48 + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        packed[byteIdx] |= (1 << bitIdx);
      }
    }
  }

  return packed;
}
