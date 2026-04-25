import { calculateAuthResponse, generateAuthBytes } from './auth';
import { processImage } from './image';

const SERVICE_UUID = 0xffe6;
const CHR_TX_UUID = 0xffe1; // Write Without Response
const CHR_RX_UUID = 0xffe2; // Notify

export interface PrinterStatus {
  battery?: number;
  isOutOfPaper?: boolean;
  isCharging?: boolean;
  isOverheat?: boolean;
  isLowBattery?: boolean;
  density?: number;
  voltage?: number;
  isPrinting: boolean;
}

export class LXD02Printer {
  private device: BluetoothDevice | null = null;
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private status: PrinterStatus | null = null;

  private onStatusChange?: (status: PrinterStatus) => void;
  private authResolver?: (result: boolean) => void;
  private printResolver?: () => void;
  private densityResolver?: (success: boolean) => void;
  private _onRetransmitRequested?: (index: number) => Promise<void> | void;
  private _resendRequestedIndex: number | null = null;
  private boundHandleNotifications: ((event: Event) => void) | null = null;

  constructor(options?: { onStatusChange?: (status: PrinterStatus) => void }) {
    this.onStatusChange = options?.onStatusChange;
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error(
        'Web Bluetooth API is not supported in this environment.'
      );
    }

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'LX' }],
        optionalServices: [SERVICE_UUID],
      });

      const server = await this.device.gatt?.connect();
      if (!server) throw new Error('Failed to connect to GATT server');

      const service = await server.getPrimaryService(SERVICE_UUID);
      this.tx = await service.getCharacteristic(CHR_TX_UUID);
      this.rx = await service.getCharacteristic(CHR_RX_UUID);

      // Start listening for notifications
      await this.rx.startNotifications();
      this.boundHandleNotifications = (event: Event) => {
        this.handleNotifications(event).catch((err) => {
          console.error('Unhandled error in GATT notification handler:', err);
        });
      };
      this.rx.addEventListener(
        'characteristicvaluechanged',
        this.boundHandleNotifications
      );

      // Start Authentication
      await this.authenticate();
    } catch (error) {
      if (this.rx && this.boundHandleNotifications) {
        this.rx.removeEventListener(
          'characteristicvaluechanged',
          this.boundHandleNotifications
        );
      }

      if (this.rx) {
        try {
          await this.rx.stopNotifications();
        } catch {
          // Best-effort cleanup; preserve the original error.
        }
      }

      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }

      this.boundHandleNotifications = null;
      this.tx = null;
      this.rx = null;

      throw error;
    }
  }

  private async authenticate(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.authResolver = undefined;
        reject(new Error('Authentication timeout'));
      }, 10000);

      this.authResolver = (success) => {
        clearTimeout(timeout);
        if (success) resolve();
        else reject(new Error('Authentication failed'));
      };

      // Stage 0: Initiate Authentication
      this.sendRaw(new Uint8Array([0x5a, 0x01])).catch((err) => {
        clearTimeout(timeout);
        this.authResolver = undefined;
        reject(err);
      });
    });
  }

  async setDensity(density: number): Promise<void> {
    if (!Number.isInteger(density)) {
      throw new Error('Density must be an integer between 1 and 7');
    }

    if (density < 1 || density > 7) {
      throw new Error('Density must be between 1 and 7');
    }

    // Guard against in-flight density changes
    if (this.densityResolver) {
      throw new Error('Density setting is already in progress');
    }

    // Skip if density is already set to the target value
    if (this.status && this.status.density === density) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.densityResolver = undefined;
        reject(new Error('Density setting timeout'));
      }, 5000);

      this.densityResolver = (success) => {
        clearTimeout(timeout);
        this.densityResolver = undefined;
        if (success) {
          if (this.status) {
            this.status.density = density;
          }
          resolve();
        } else {
          reject(new Error('Failed to set density'));
        }
      };

      this.sendRaw(new Uint8Array([0x5a, 0x0c, density - 1])).catch((err) => {
        clearTimeout(timeout);
        this.densityResolver = undefined;
        reject(err);
      });
    });
  }

  async print(
    data: HTMLImageElement | HTMLCanvasElement | Uint8Array,
    options?: { density?: number }
  ): Promise<void> {
    if (!this.tx) throw new Error('Printer not connected');

    if (this.status?.isPrinting) {
      throw new Error('Printer is already printing');
    }

    if (!this.status) {
      this.status = {
        isPrinting: false,
      };
    }

    this.status.isPrinting = true;
    this.onStatusChange?.({ ...this.status });

    try {
      if (options?.density !== undefined) {
        await this.setDensity(options.density);
      }

      const packets = processImage(data);
      const packetCount = packets.length;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.printResolver = undefined;
          this._onRetransmitRequested = undefined;
          reject(new Error('Print timeout'));
        }, 30000);

        this.printResolver = () => {
          clearTimeout(timeout);
          this._onRetransmitRequested = undefined;
          resolve();
        };

        const sendPacketsFrom = async (startIndex: number) => {
          isSending = true;
          try {
            let i = startIndex;
            while (i < packetCount) {
              // Check if a retransmission was requested via notification during the loop
              if (this._resendRequestedIndex !== null) {
                const target = this._resendRequestedIndex;
                this._resendRequestedIndex = null;
                if (target < packetCount) {
                  i = target;
                }
              }

              await this.sendRaw(packets[i]!);
              i++;
            }
          } catch (err) {
            clearTimeout(timeout);
            this.printResolver = undefined;
            this._onRetransmitRequested = undefined;
            reject(err);
          } finally {
            isSending = false;
          }
        };

        // 1. Send Print Start Command
        // Length = (Total lines rounded up / 2) + 1 (which is packets.length)
        const startCmd = new Uint8Array([
          0x5a,
          0x04,
          (packetCount >> 8) & 0xff,
          packetCount & 0xff,
          0x00,
          0x00,
        ]);

        let isSending = false;

        this._onRetransmitRequested = async (targetIndex: number) => {
          if (isSending) {
            // If a loop is already running, just update the index so the loop will jump backwards.
            this._resendRequestedIndex = targetIndex;
          } else {
            // If the loop finished but we haven't received completion (0x06) yet, start a new loop.
            this._resendRequestedIndex = null;
            await sendPacketsFrom(targetIndex);
          }
        };

        this.sendRaw(startCmd)
          .then(() => sendPacketsFrom(0))
          .catch((err) => {
            clearTimeout(timeout);
            this.printResolver = undefined;
            this._onRetransmitRequested = undefined;
            reject(err);
          });
      });
    } finally {
      if (this.status) {
        this.status.isPrinting = false;
        this.onStatusChange?.({ ...this.status });
      }
    }
  }

  private async handleNotifications(event: Event) {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    if (!characteristic.value) return;
    const value = new Uint8Array(
      characteristic.value.buffer,
      characteristic.value.byteOffset,
      characteristic.value.byteLength
    );
    if (value.length < 2 || value[0] !== 0x5a) return;

    const cmd = value[1];

    switch (cmd) {
      case 0x01: // Auth Stage 1: Received MAC
        if (value.length >= 10) {
          const mac = value.subarray(4, 10);
          const authBytes = generateAuthBytes();
          const response = calculateAuthResponse(authBytes, mac);

          // Store auth state if needed, or just send immediately
          this._lastAuthResponse = response;

          // Send Challenge
          const challengeCmd = new Uint8Array(12);
          challengeCmd[0] = 0x5a;
          challengeCmd[1] = 0x0a;
          challengeCmd.set(authBytes, 2);
          await this.sendRaw(challengeCmd);
        }
        break;

      case 0x0a: // Auth Stage 2: Prompt for response
        if (this._lastAuthResponse) {
          const respCmd = new Uint8Array(12);
          respCmd[0] = 0x5a;
          respCmd[1] = 0x0b;
          respCmd.set(this._lastAuthResponse, 2);
          await this.sendRaw(respCmd);
          this._lastAuthResponse = undefined;
        }
        break;

      case 0x0b: // Auth Stage 3: Result
        if (this.authResolver && value.length >= 3) {
          this.authResolver(value[2] === 0x01);
          this.authResolver = undefined;
        }
        break;

      case 0x0c: // Density setting ACK
        if (this.densityResolver && value.length >= 3) {
          this.densityResolver(true);
        }
        break;

      case 0x05: // Retransmission Request
        if (value.length >= 4) {
          const seq = (value[2]! << 8) | value[3]!;
          // Based on observations: Packet 0x0075 triggers resend from sequence 116 (0x74)
          const targetIndex = Math.max(0, seq - 1);
          if (this._onRetransmitRequested) {
            const result = this._onRetransmitRequested(targetIndex);
            if (result instanceof Promise) {
              await result;
            }
          } else {
            this._resendRequestedIndex = targetIndex;
          }
        }
        break;

      case 0x02: // Status
        if (value.length >= 12) {
          const status: PrinterStatus = {
            battery: value[2]!,
            isOutOfPaper: value[3] === 0x01,
            isCharging: value[4] === 0x01,
            isOverheat: value[5] === 0x01,
            isLowBattery: value[6] === 0x01,
            density: value[7]! + 1,
            voltage: (value[8]! << 8) | value[9]!,
            isPrinting: this.status?.isPrinting ?? false,
          };
          this.status = status;
          this.onStatusChange?.({ ...status });
        }
        break;

      case 0x06: // Print Completion
        if (value.length >= 4) {
          const printLen = (value[2]! << 8) | value[3]!;
          // Send ACK
          await this.sendRaw(
            new Uint8Array([
              0x5a,
              0x04,
              (printLen >> 8) & 0xff,
              printLen & 0xff,
              0x01,
              0x00,
            ])
          );
          if (this.printResolver) {
            this.printResolver();
            this.printResolver = undefined;
          }
        }
        break;
    }
  }

  private _lastAuthResponse?: Uint8Array;

  private async sendRaw(data: Uint8Array): Promise<void> {
    if (!this.tx) throw new Error('TX Characteristic not available');
    // Web Bluetooth GATT characteristic writeValueWithoutResponse
    await this.tx.writeValueWithoutResponse(data as BufferSource);
  }

  disconnect(): void {
    if (this.rx && this.boundHandleNotifications) {
      this.rx.removeEventListener(
        'characteristicvaluechanged',
        this.boundHandleNotifications
      );
      this.rx.stopNotifications().catch(() => {});
      this.boundHandleNotifications = null;
    }
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }
}
