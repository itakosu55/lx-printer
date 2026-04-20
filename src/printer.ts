import { calculateAuthResponse, generateAuthBytes } from "./auth";
import { processImage, ImageProcessingOptions } from "./image";

const SERVICE_UUID = 0xffe6;
const CHR_TX_UUID = 0xffe1; // Write Without Response
const CHR_RX_UUID = 0xffe2; // Notify

export interface PrinterStatus {
  battery: number;
  isOutOfPaper: boolean;
  isCharging: boolean;
  isOverheat: boolean;
  isLowBattery: boolean;
  voltage: number;
}

export class LXD02Printer {
  private device: BluetoothDevice | null = null;
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private status: PrinterStatus | null = null;

  private onStatusChange?: (status: PrinterStatus) => void;
  private authResolver?: (result: boolean) => void;
  private printResolver?: () => void;

  constructor(options?: { onStatusChange?: (status: PrinterStatus) => void }) {
    this.onStatusChange = options?.onStatusChange;
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth API is not supported in this environment.");
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "LX" }],
      optionalServices: [SERVICE_UUID],
    });

    const server = await this.device.gatt?.connect();
    if (!server) throw new Error("Failed to connect to GATT server");

    const service = await server.getPrimaryService(SERVICE_UUID);
    this.tx = await service.getCharacteristic(CHR_TX_UUID);
    this.rx = await service.getCharacteristic(CHR_RX_UUID);

    // Start listening for notifications
    await this.rx.startNotifications();
    this.rx.addEventListener("characteristicvaluechanged", this.handleNotifications.bind(this));

    // Start Authentication
    await this.authenticate();
  }

  private async authenticate(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Authentication timeout")), 10000);
      this.authResolver = (success) => {
        clearTimeout(timeout);
        if (success) resolve();
        else reject(new Error("Authentication failed"));
      };

      // Stage 0: Initiate Authentication
      await this.sendRaw(new Uint8Array([0x5a, 0x01]));
    });
  }

  async print(data: HTMLImageElement | HTMLCanvasElement | Uint8Array, options: ImageProcessingOptions = {}): Promise<void> {
    if (!this.tx) throw new Error("Printer not connected");

    const packets = processImage(data, options);
    const packetCount = packets.length;

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Print timeout")), 30000);
      this.printResolver = () => {
        clearTimeout(timeout);
        resolve();
      };

      // 1. Send Print Start Command
      // Length = (Total lines rounded up / 2) + 1 (which is packets.length)
      const startCmd = new Uint8Array([0x5a, 0x04, (packetCount >> 8) & 0xff, packetCount & 0xff, 0x00, 0x00]);
      await this.sendRaw(startCmd);

      // 2. Send Packets
      // Note: We might need small delays between packets for stability depending on the hardware
      for (const packet of packets) {
        await this.sendRaw(packet);
      }
    });
  }

  private async handleNotifications(event: any) {
    const value = new Uint8Array((event.target as BluetoothRemoteGATTCharacteristic).value!.buffer);
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
        if (this.authResolver) {
          this.authResolver(value[2] === 0x01);
          this.authResolver = undefined;
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
            voltage: (value[8]! << 8) | value[9]!,
          };
          this.status = status;
          this.onStatusChange?.(status);
        }
        break;

      case 0x06: // Print Completion
        const printLen = (value[2]! << 8) | value[3]!;
        // Send ACK
        await this.sendRaw(new Uint8Array([0x5a, 0x04, (printLen >> 8) & 0xff, printLen & 0xff, 0x01, 0x00]));
        if (this.printResolver) {
          this.printResolver();
          this.printResolver = undefined;
        }
        break;
    }
  }

  private _lastAuthResponse?: Uint8Array;

  private async sendRaw(data: Uint8Array): Promise<void> {
    if (!this.tx) throw new Error("TX Characteristic not available");
    // Web Bluetooth GATT characteristic writeValueWithoutResponse
    await this.tx.writeValueWithoutResponse(data as any);
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }
}
