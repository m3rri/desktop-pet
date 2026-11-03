// 렌더러(index.html)에 window.pet 으로 노출하는 API. 렌더러는 Node.js에 직접 접근하지 않음
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  load: () => ipcRenderer.invoke('pet:load'),
  onState: (cb) => ipcRenderer.on('pet:state', (_e, state) => cb(state)),
  onFacing: (cb) => ipcRenderer.on('pet:facing', (_e, facing) => cb(facing)),
  onCursor: (cb) => ipcRenderer.on('pet:cursor', (_e, pos) => cb(pos)),
  setInteractive: (interactive) => ipcRenderer.send('pet:set-interactive', interactive),
  frame: () => ipcRenderer.send('pet:frame'),
  click: () => ipcRenderer.send('pet:click'),
  animEnd: (state) => ipcRenderer.send('pet:anim-end', state),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  menu: () => ipcRenderer.send('pet:menu'),
});
