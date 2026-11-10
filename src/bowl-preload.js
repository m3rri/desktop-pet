// 밥그릇 창(bowl.html)에 window.bowl 로 노출하는 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bowl', {
  load: () => ipcRenderer.invoke('bowl:load'),
  onLevel: (cb) => ipcRenderer.on('bowl:level', (_e, level) => cb(level)),
  onReload: (cb) => ipcRenderer.on('bowl:reload', () => cb()),
  onCursor: (cb) => ipcRenderer.on('bowl:cursor', (_e, pos) => cb(pos)),
  setInteractive: (v) => ipcRenderer.send('bowl:set-interactive', v),
  dragStart: () => ipcRenderer.send('bowl:drag-start'),
  dragEnd: () => ipcRenderer.send('bowl:drag-end'),
  dblclick: () => ipcRenderer.send('bowl:dblclick'),
  menu: () => ipcRenderer.send('bowl:menu'),
});
