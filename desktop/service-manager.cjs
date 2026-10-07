const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function getJson(url, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid health response')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Health check timed out')));
    request.on('error', reject);
  });
}

class ServiceManager {
  constructor({ appRoot, userData, packaged, log }) {
    this.appRoot = appRoot;
    this.userData = userData;
    this.packaged = packaged;
    this.log = log;
    this.children = [];
    this.statuses = new Map();
  }

  executable(name, moduleName) {
    if (this.packaged) return path.join(process.resourcesPath, 'runtime', `${name}.exe`);
    return process.platform === 'win32' ? path.join(this.appRoot, 'venv', 'Scripts', 'python.exe') : path.join(this.appRoot, 'venv', 'bin', 'python');
  }

  command(name, moduleName, port) {
    if (this.packaged) return { file: this.executable(name, moduleName), args: [], cwd: process.resourcesPath };
    return { file: this.executable(name, moduleName), args: ['-m', 'uvicorn', `${moduleName}:app`, '--host', '127.0.0.1', '--port', String(port)], cwd: this.appRoot };
  }

  async startService(name, moduleName, port, env = {}) {
    this.statuses.set(name, 'STARTING');
    const command = this.command(name, moduleName, port);
    if (!fs.existsSync(command.file)) throw new Error(`${name} executable not found: ${command.file}`);
    const child = spawn(command.file, command.args, { cwd: command.cwd, env: { ...process.env, ...env }, windowsHide: true });
    this.children.push(child);
    child.stdout?.on('data', (data) => this.log(`[${name}] ${data}`));
    child.stderr?.on('data', (data) => this.log(`[${name}] ${data}`));
    child.on('exit', (code) => { if (this.statuses.get(name) !== 'STOPPED') this.statuses.set(name, 'ERROR'); this.log(`${name} exited (${code})`); });
    await this.waitForHealth(`http://127.0.0.1:${port}/health`, name);
    this.statuses.set(name, 'READY');
  }

  async waitForHealth(url, name, attempts = 150) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try { return await getJson(url); } catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 1000)); }
    }
    this.statuses.set(name, 'ERROR');
    throw new Error(`${name} health check failed: ${lastError?.message || 'timeout'}`);
  }

  async start() {
    const backendPort = await freePort();
    const modelPort = await freePort();
    const runtimeRoot = this.packaged ? path.join(process.resourcesPath, 'runtime') : this.appRoot;
    await this.startService('model', 'model_service.app', modelPort, { MODEL_SERVICE_PORT: String(modelPort), MODEL_SERVICE_PUBLIC_BASE: `http://127.0.0.1:${modelPort}`, MODEL_SERVICE_OUT: path.join(this.userData, 'model-data'), FACTECH_RUNTIME_ROOT: runtimeRoot });
    await this.startService('backend', 'app.main', backendPort, { PORT: String(backendPort), MODEL_3D_PROVIDER: 'local', MODEL_3D_URL: `http://127.0.0.1:${modelPort}`, FACTECH_DATA_DIR: this.userData, FACTECH_RUNTIME_ROOT: runtimeRoot });
    return { backendUrl: `http://127.0.0.1:${backendPort}`, modelUrl: `http://127.0.0.1:${modelPort}` };
  }

  snapshot() { return Object.fromEntries(this.statuses.entries()); }

  stop() {
    this.statuses.forEach((_, name) => this.statuses.set(name, 'STOPPED'));
    for (const child of this.children) { try { child.kill(); } catch {} }
    this.children = [];
  }
}

module.exports = { ServiceManager };