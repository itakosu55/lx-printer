# lx-printer/lx-d02

A TypeScript library for controlling the LX-D02 thermal printer via the Web Bluetooth API. This library allows you to print images and raw binary data directly from your browser.

## Features

- **Web Bluetooth GATT Communication**: Connects directly to LX-D02 devices.
- **Automatic Image Processing**:
  - Effortlessly resize images to 384px width.
  - Convert to grayscale using luminance correction (Y = 0.299R + 0.587G + 0.114B).
  - Apply Floyd-Steinberg dithering for high-quality monochrome output.
- **Raw Data Printing**: Send pre-formatted 384px binary data directly using `Uint8Array`.
- **Status Monitoring**: Real-time updates for battery level, voltage, charging state, and error flags (out of paper, overheat, etc.).
- **Retransmission Support**: Automatically handles retransmission requests from the printer for stable communication.
- **Browser Only**: Explicit environment checks to prevent accidental use in non-browser environments (Node.js).

## Installation

```bash
npm install lx-printer
```

## Usage

### Basic Image Printing

```typescript
import { LXD02Printer } from 'lx-printer/lx-d02';

const printer = new LXD02Printer({
  onStatusChange: (status) => {
    console.log(`Battery: ${status.battery}%`);
    if (status.isOutOfPaper) {
      console.error('Out of paper!');
    }
  },
});

// Request device and connect
await printer.connect();

// Print an HTML image or canvas element
const img = document.getElementById('my-image') as HTMLImageElement;
await printer.print(img);

// Disconnect when done
printer.disconnect();
```

### Printing Raw Binary Data

If you have pre-dithered 384px wide data (48 bytes per line), you can send it directly.

```typescript
const rawData = new Uint8Array(48 * 100); // 100 lines
// ... fill data ...
await printer.print(rawData);
```

## API Reference

### `LXD02Printer`

#### `constructor(options?: { onStatusChange?: (status: PrinterStatus) => void })`

- `onStatusChange`: Callback triggered when the printer notifies its status.

#### `connect(): Promise<void>`

Requests a Bluetooth device matching the LX prefix and establishes a connection. Performs challenge-response authentication automatically.

#### `print(data: HTMLImageElement | HTMLCanvasElement | Uint8Array): Promise<void>`

Sends print data to the printer.

- If `data` is `HTMLImageElement` or `HTMLCanvasElement`, it will be automatically resized to 384px width, converted to grayscale, and dithered.
- If `data` is a `Uint8Array`, it is treated as raw 1-bit-per-pixel binary data (must be a multiple of 48 bytes).

#### `disconnect(): void`

Disconnects the current GATT connection.

### `PrinterStatus`

- `battery`: number (0-100)
- `voltage`: number (mV)
- `isCharging`: boolean
- `isOutOfPaper`: boolean
- `isOverheat`: boolean
- `isLowBattery`: boolean

## Acknowledgments

The protocol implementation in this library is based on the research and reference implementation provided by [paradon/lxprint](https://github.com/paradon/lxprint).

## License

MIT
