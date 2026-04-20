/**
 * CRC-16/XMODEM calculation (polynomial: 0x1021)
 */
export function calculateCrc16Xmodem(data: Uint8Array): number {
  let crc = 0x0000;
  const polynomial = 0x1021;

  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ polynomial;
      } else {
        crc <<= 1;
      }
      crc &= 0xffff;
    }
  }
  return crc;
}

/**
 * Stage 1: Generate random challenge bytes (10 bytes)
 */
export function generateAuthBytes(): Uint8Array {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Stage 2: Calculate 10-byte response from challenge bytes and MAC address
 *
 * Each response byte is the MSB of a CRC-16 calculation:
 * CRC16([authByte, ...macAddress])
 */
export function calculateAuthResponse(
  authBytes: Uint8Array,
  macAddress: Uint8Array
): Uint8Array {
  if (authBytes.length !== 10) throw new Error('authBytes must be 10 bytes');
  if (macAddress.length !== 6) throw new Error('macAddress must be 6 bytes');

  const response = new Uint8Array(10);
  for (let i = 0; i < 10; i++) {
    const dataToCrc = new Uint8Array(7);
    dataToCrc[0] = authBytes[i]!;
    dataToCrc.set(macAddress, 1);

    const crc = calculateCrc16Xmodem(dataToCrc);
    response[i] = (crc >> 8) & 0xff;
  }
  return response;
}
