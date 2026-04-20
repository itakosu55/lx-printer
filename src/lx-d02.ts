import { LXD02Printer as BaseLXD02Printer } from './printer';

function assertSupportedEnvironment() {
  const isBrowser =
    typeof window !== 'undefined' && typeof navigator !== 'undefined';
  const isBluetoothSupported = isBrowser && 'bluetooth' in navigator;

  if (!isBrowser) {
    throw new Error(
      'lx-printer/lx-d02: This library is intended for use in a browser environment only and is not compatible with Node.js or other server-side environments.'
    );
  }

  if (!isBluetoothSupported) {
    throw new Error(
      'lx-printer/lx-d02: Web Bluetooth API is not supported in this browser. The printer library will not function.'
    );
  }
}

export class LXD02Printer extends BaseLXD02Printer {
  connect(
    ...args: Parameters<BaseLXD02Printer['connect']>
  ): ReturnType<BaseLXD02Printer['connect']> {
    assertSupportedEnvironment();
    return super.connect(...args);
  }
}

export type { PrinterStatus } from './printer';
