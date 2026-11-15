// Runs before the Aria page in every window.
const { contextBridge } = require("electron");

// Chrome's speech recognition talks to a Google service that only Chrome itself has keys for.
// Inside the app it exists but every attempt fails, so the page is told it is not there. Aria
// then does what it does in Firefox: Gemini hears the student directly.
contextBridge.executeInMainWorld({
  func: () => {
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      try {
        Object.defineProperty(window, name, { value: undefined, configurable: true, writable: true });
      } catch {
        // Leave it as it is.
      }
    }
  },
});
