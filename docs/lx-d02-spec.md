# LX-D02 Thermal Printer Bluetooth Communication Specification

This document summarizes the specifications of the communication protocol and data format for controlling the LX-D02 thermal printer via the Web Bluetooth API (GATT).

## 1. Basic Specifications

### 1.1. Bluetooth GATT Profile

- **Device Name Filter**: Device names starting with `LX` (`namePrefix: "LX"`)

- **Primary Service UUID**: `0xffe6`

- **Characteristics**:
  - **Tx (Transmit)**: `0xffe1` (Write Without Response)

  - **Rx (Receive)**: `0xffe2` (Notify)

All communication is performed using byte arrays (`Uint8Array`). Many control messages use `0x5A` as a header.

## 2. Communication Sequence and Command Specifications

### 2.1. Connection and Authentication (Handshake)

After connecting to the printer, a proprietary challenge-response authentication must be performed to establish communication.

#### Stage 0: Initiate Authentication

The host requests the printer to start authentication.

- **Host -> Printer**: `[0x5A, 0x01]`

#### Stage 1: Retrieve MAC Address and Send Challenge

The printer returns data containing its own MAC address.

- **Printer -> Host**: `[0x5A, 0x01, xx, xx, M0, M1, M2, M3, M4, M5, ...]`
  - The 6 bytes from `Byte[4]` to `[9]` are the printer's MAC address.

The host performs the following processes:

1. Generates a 10-byte random byte array (`authBytes`).

2. Appends the MAC address (6 bytes) to the end of each random byte (1 byte) to create **7 bytes of data**, and calculates a **CRC-16/XMODEM** (`0x1021` polynomial) for each. This results in ten 16-bit CRC values (`authCrc`).

3. Sends the generated 10 bytes of random data to the printer.

- **Host -> Printer**: `[0x5A, 0x0A, ...authBytes (10 bytes)]` (12 bytes total)

#### Stage 2: Challenge Response

When the printer receives the challenge, it returns a response.

- **Printer -> Host**: `[0x5A, 0x0A, ...]`

The host extracts only the **upper 8 bits (MSB)** from the calculated ten `authCrc` (16-bit) values and sends them as a 10-byte response.

- **Host -> Printer**: `[0x5A, 0x0B, crc0_MSB, crc1_MSB, ..., crc9_MSB]` (12 bytes total)

#### Stage 3: Authentication Result

The printer returns the authentication result.

- **Printer -> Host**: `[0x5A, 0x0B, Result, ...]`
  - `Result == 0x01`: Authentication successful. Subsequent print commands, etc., will be accepted.

  - Otherwise: Authentication failed (communication disconnected).

### 2.2. Status Notification

The printer asynchronously notifies its own status.

- **Printer -> Host**: `[0x5A, 0x02, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11]`
  - `Byte[2]`: Battery level (%)

  - `Byte[3]`: Out of paper error flag (`0`: Normal, `1`: Out of paper)

  - `Byte[4]`: Charging flag (`0`: Discharging, `1`: Charging)

  - `Byte[5]`: Overheat error flag (`0`: Normal, `1`: Overheat)

  - `Byte[6]`: Low battery flag (`0`: Normal, `1`: Low)

  - `Byte[7]`: Print Density

  - `Byte[8]-[9]`: Voltage (millivolts, 16-bit Big Endian)

  - `Byte[10], [11]`: Undefined/Reserved area

### 2.3. Printing Process

#### Image Format Requirements

- **Width**: The target width for the LX printer is fixed at **384 pixels**.

- The image data uses data where 1 pixel is converted to 1-bit black and white (White=0, Black=1) using dithering or similar methods.

- 384 pixels equals **48 bytes** per line (384 / 8).

- For the LX printer, **2 lines (96 bytes)** are packed into a single packet and sent.

#### Printing Flow

**1. Send Print Start Command**
Notify the printer of the total number of data blocks (packets) to be sent. The total number of packets includes an empty packet (+1) to indicate the end of data.

- **Host -> Printer**: `[0x5A, 0x04, Length_MSB, Length_LSB, 0x00, 0x00]`
  - `Length` = `(Total lines rounded up / 2) + 1`

**2. Send Print Data**
Each packet consists of a fixed length of **100 bytes**. This is sent consecutively `Length - 1` times.

- **Data Packet Structure (100 Bytes)**:
  - `Byte[0]`: `0x55` (Line header)

  - `Byte[1]-[2]`: Sequence number (Starts from 0, 16-bit Big Endian)

  - `Byte[3]-[98]`: Image data (96 bytes = 2 lines × 48 bytes)

  - `Byte[99]`: `0x00` (Padding)

**3. Send Data End (Footer) Packet**
Finally, an empty packet of image data is sent to signal the end of the data transfer.

- **Host -> Printer**: `[0x55, LastSeq_MSB, LastSeq_LSB, 0x00, 0x00, ..., 0x00]` (100 bytes)

**4. Confirm Print Completion and Send ACK**
When printing is complete, a completion notice is sent from the printer.

- **Printer -> Host**: `[0x5A, 0x06, PrintLen_MSB, PrintLen_LSB, ...]`

After receiving this, the host replies with the following command as an acknowledgment (ACK).

- **Host -> Printer**: `[0x5A, 0x04, PrintLen_MSB, PrintLen_LSB, 0x01, 0x00]`

This returns the printer to a standby state (connected) where it can accept the next print.

### 2.4. Error Recovery (Retransmission)

During the image data transfer (Stage 2), the printer may request a retransmission if it detects a sequence gap or communication error.

- **Printer -> Host**: `[0x5A, 0x05, Seq_MSB, Seq_LSB, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]` (12 bytes)
  - `Byte[2]-[3]`: The sequence number the printer next expects or failed at.

Upon receiving this packet, the host should immediately stop the current transfer and resume sending data packets starting from the specified sequence number (or `Seq - 1` depending on implementation observed in official apps).

_Note: In analyzed official app logs, a request with `0x0075` triggered retransmission from sequence `116 (0x74)`, suggesting the printer might indicate the next expected 1-based index, while the host uses 0-based indices._
