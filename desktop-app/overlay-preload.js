// The screen overlay page's only way to talk to the app (screen.js).
const { contextBridge, ipcRenderer } = require("electron");

const FROM_MAIN = ["mark:prepare", "mark:start", "mark:cancel", "notice"];

contextBridge.exposeInMainWorld("aria", {
  on(channel, fn) {
    if (FROM_MAIN.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
  prepared: () => ipcRenderer.send("mark:prepared"),
  setInteractive: (on) => ipcRenderer.send("overlay:interactive", Boolean(on)),
  markEnded: () => ipcRenderer.send("mark:ended"),
});
