const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('factech', {
  getBackendUrl: () => ipcRenderer.invoke('factech:backend-url'),
  getServiceStatus: () => ipcRenderer.invoke('factech:service-status'),
  retryServices: () => ipcRenderer.invoke('factech:retry-services'),
});