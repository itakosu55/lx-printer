/**
 * LX-D02 BLE wire protocol constants.
 *
 * Frame layout: `[FRAME_HEADER, cmd, ...payload]`. The same `cmd` byte is
 * sometimes reused in both directions (e.g. `AUTH_CHALLENGE` is both received
 * as a prompt from the printer and sent back as the challenge frame).
 */

export const SERVICE_UUID = 0xffe6;
export const CHR_TX_UUID = 0xffe1; // Write Without Response
export const CHR_RX_UUID = 0xffe2; // Notify

export const FRAME_HEADER = 0x5a;

export const Cmd = {
  /** TX: kick off auth handshake. RX: printer replies with its MAC. */
  AUTH_INIT: 0x01,
  /** RX: status snapshot (battery, paper, density, voltage, ...). */
  STATUS: 0x02,
  /** TX: print start command, and per-completion ACK. */
  PRINT: 0x04,
  /** RX: retransmission request from the printer. */
  RETRANSMIT: 0x05,
  /** RX: print completion notification. */
  PRINT_END: 0x06,
  /** RX: prompt for response. TX: challenge bytes. */
  AUTH_CHALLENGE: 0x0a,
  /** TX: response bytes. RX: auth result. */
  AUTH_RESPONSE: 0x0b,
  /** TX: set density. RX: density ACK. */
  DENSITY: 0x0c,
} as const;
