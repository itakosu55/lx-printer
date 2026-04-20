import { LXD02Printer } from '../src/lx-d02';

const btnConnect = document.getElementById('btn-connect') as HTMLButtonElement;
const btnPrint = document.getElementById('btn-print') as HTMLButtonElement;
const btnPrintFile = document.getElementById(
  'btn-print-file'
) as HTMLButtonElement;
const btnClearLog = document.getElementById(
  'btn-clear-log'
) as HTMLButtonElement;
const inputFile = document.getElementById('input-file') as HTMLInputElement;

const statusBadge = document.getElementById('status-badge') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const statBattery = document.getElementById('stat-battery') as HTMLDivElement;
const statVoltage = document.getElementById('stat-voltage') as HTMLDivElement;
const statCharging = document.getElementById('stat-charging') as HTMLDivElement;
const statFlags = document.getElementById('stat-flags') as HTMLDivElement;
const logConsole = document.getElementById('console') as HTMLDivElement;

let printer: LXD02Printer | null = null;
let isConnected = false;

function log(message: string, type: 'info' | 'error' | 'success' = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logConsole.appendChild(entry);
  logConsole.scrollTop = logConsole.scrollHeight;
}

function handleError(err: unknown, prefix: string) {
  const message = err instanceof Error ? err.message : String(err);
  log(`${prefix}: ${message}`, 'error');
}

btnClearLog.addEventListener('click', () => {
  logConsole.innerHTML = '';
});

function updateUI() {
  if (isConnected) {
    statusBadge.className = 'status-badge connected';
    statusText.textContent = 'Connected';
    btnConnect.textContent = 'Disconnect';
    btnConnect.disabled = false;
    btnPrint.disabled = false;
    btnPrintFile.disabled = false;
  } else {
    statusBadge.className = 'status-badge';
    statusText.textContent = 'Disconnected';
    btnConnect.textContent = 'Connect Printer';
    btnConnect.disabled = false;
    btnPrint.disabled = true;
    btnPrintFile.disabled = true;

    statBattery.textContent = '-- %';
    statVoltage.textContent = '---- mV';
    statCharging.textContent = '--';
    statFlags.textContent = 'No Data';
  }
}

btnConnect.addEventListener('click', async () => {
  if (isConnected && printer) {
    log('Disconnecting...');
    printer.disconnect();
    isConnected = false;
    updateUI();
    log('Disconnected.', 'info');
    return;
  }

  try {
    log('Requesting Bluetooth device...');
    btnConnect.disabled = true;
    statusBadge.className = 'status-badge connecting';
    statusText.textContent = 'Connecting...';

    printer = new LXD02Printer({
      onStatusChange: (status) => {
        statBattery.textContent = `${status.battery}%`;
        statVoltage.textContent = `${status.voltage} mV`;
        statCharging.textContent = status.isCharging ? 'Yes' : 'No';
        statCharging.style.color = status.isCharging
          ? 'var(--success)'
          : 'inherit';

        const flags: string[] = [];
        if (status.isOutOfPaper) flags.push('OUT_OF_PAPER');
        if (status.isOverheat) flags.push('OVERHEAT');
        if (status.isLowBattery) flags.push('LOW_BATTERY');

        statFlags.textContent = flags.length > 0 ? flags.join(', ') : 'Normal';
        statFlags.style.color =
          flags.length > 0 ? 'var(--error)' : 'var(--success)';
      },
    });

    await printer.connect();
    isConnected = true;
    updateUI();
    log('Printer connected and authenticated!', 'success');
  } catch (err) {
    handleError(err, 'Connection failed');
    isConnected = false;
    updateUI();
  }
});

btnPrint.addEventListener('click', async () => {
  if (!printer) return;

  try {
    log('Generating test pattern...');
    btnPrint.disabled = true;
    btnPrintFile.disabled = true;

    const height = 64;
    const data = new Uint8Array(48 * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < 48; x++) {
        const idx = y * 48 + x;
        if (y < 8) data[idx] = 0xff;
        else if (y < 16) data[idx] = 0xaa;
        else if (y < 24) data[idx] = y % 2 === 0 ? 0xff : 0x00;
        else if (y < 48) {
          const cellY = Math.floor(y / 8);
          data[idx] = cellY % 2 === 0 ? 0xaa : 0x55;
        } else data[idx] = y % 2 === 0 ? 0x80 : 0x01;
      }
    }

    log('Sending print commands...');
    await printer.print(data);
    log('Print completed.', 'success');
  } catch (err) {
    handleError(err, 'Print failed');
  } finally {
    btnPrint.disabled = false;
    btnPrintFile.disabled = false;
  }
});

btnPrintFile.addEventListener('click', () => {
  inputFile.click();
});

inputFile.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !printer) return;

  try {
    log(`Loading ${file.name}...`);
    btnPrint.disabled = true;
    btnPrintFile.disabled = true;

    const url = URL.createObjectURL(file);
    const img = new Image();

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    log('Processing and printing image...');
    await printer.print(img);
    log('Printing finished!', 'success');

    URL.revokeObjectURL(url);
  } catch (err) {
    handleError(err, 'Print failed');
  } finally {
    btnPrint.disabled = false;
    btnPrintFile.disabled = false;
    inputFile.value = '';
  }
});
