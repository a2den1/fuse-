/*
 * 설정 화면과 메인 프로세스 사이의 다리.
 * 딱 필요한 세 가지만 열어둔다 — 화면 쪽에서 Node 에 손대지 못하게.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fuse', {
  saveCredentials: (values) => ipcRenderer.invoke('fuse:save-credentials', values),
  openExternal: (url) => ipcRenderer.invoke('fuse:open-external', url),
  redirectUri: () => ipcRenderer.invoke('fuse:redirect-uri'),
});
