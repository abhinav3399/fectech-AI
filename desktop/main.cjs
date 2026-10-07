const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { ServiceManager } = require('./service-manager.cjs');

let mainWindow;
let manager;
let serviceUrls;

function logLine(message) {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'desktop.log'), `${new Date().toISOString()} ${String(message).replace(/(api[_-]?key|token|password)=?\s*\S+/gi, '$1=[redacted]')}\n`);
}

async function startServices() {
  manager = new ServiceManager({ appRoot: path.resolve(__dirname, '..'), userData: app.getPath('userData'), packaged: app.isPackaged, log: logLine });
  serviceUrls = await manager.start();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1024, minHeight: 700,
    backgroundColor: '#05070a',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.loadURL(serviceUrls.backendUrl);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) require('electron').shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(async () => {
  ipcMain.handle('factech:backend-url', () => serviceUrls?.backendUrl || null);
  ipcMain.handle('factech:service-status', () => manager?.snapshot() || {});
  ipcMain.handle('factech:retry-services', async () => { manager?.stop(); await startServices(); return manager.snapshot(); });
  try { await startServices(); createWindow(); } catch (error) { logLine(error.stack || error); await dialog.showMessageBox({ type: 'error', title: 'Factech AI could not start', message: error.message, detail: 'Check the desktop.log file in FactechAI application data.' }); app.quit(); }
});

app.on('window-all-closed', () => { manager?.stop(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => manager?.stop());