import { LXD02Printer } from "./printer";

// Environment check: Ensure we are in a browser environment with Web Bluetooth support
const isBrowser = typeof window !== "undefined" && typeof navigator !== "undefined";
const isBluetoothSupported = isBrowser && "bluetooth" in navigator;

if (!isBrowser) {
  throw new Error(
    "lx-printer/lx-d02: This library is intended for use in a browser environment only and is not compatible with Node.js or other server-side environments."
  );
}

if (!isBluetoothSupported) {
  console.warn("lx-printer/lx-d02: Web Bluetooth API is not supported in this browser. The printer library will not function.");
}

export { LXD02Printer };
export type { PrinterStatus } from "./printer";
export type { ImageProcessingOptions } from "./image";
