// 말풍선 창(bubble.html)에 window.bubble 로 노출하는 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubble', {
  onShow: (cb) => ipcRenderer.on('bubble:show', (_e, text) => cb(text)),
  onTail: (cb) => ipcRenderer.on('bubble:tail', (_e, x) => cb(x)),
  onHide: (cb) => ipcRenderer.on('bubble:hide', () => cb()),
  size: (size) => ipcRenderer.send('bubble:size', size),
});
