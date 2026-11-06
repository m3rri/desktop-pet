// 설정 창(settings.html)에 window.settingsApi 로 노출하는 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  addFolder: () => ipcRenderer.invoke('settings:add-folder'),
  removeFolder: (id) => ipcRenderer.invoke('settings:remove-folder', id),
  createPetFolder: () => ipcRenderer.invoke('settings:create-pet-folder'),
  reloadPet: () => ipcRenderer.invoke('settings:reload-pet'),
  openFolder: (which) => ipcRenderer.invoke('settings:open-folder', which),
  pauseShortcut: () => ipcRenderer.invoke('settings:pause-shortcut'),
  resumeShortcut: () => ipcRenderer.invoke('settings:resume-shortcut'),
  onChanged: (cb) => ipcRenderer.on('settings:changed', (_e, state) => cb(state)),
});
