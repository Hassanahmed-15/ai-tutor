# Aria desktop app

Aria in its own window, with its own icon, for Mac and Windows. Built with Electron.

The app shows the live Aria website, so everything on the website is in the app, and the app updates whenever the website is deployed. None of Aria's code or keys are inside it.

It also lets a student **mark anything on their screen**: press **Ctrl+Alt+A** (⌃⌥A on a Mac) in any app, circle or underline something, and Aria explains it on a tiny blackboard beside the mark, then plays a short slide about it. "Make a full video" turns it into a narrated video of about a minute.

## Installers

After a build, the files to send are in `dist/`:

- Mac: `Aria-1.1.0-universal.dmg` (works on Intel and Apple-chip Macs)
- Windows: `Aria-Setup-1.1.0.exe` (64-bit Windows 10/11)

## Installing

**Mac**

1. Double-click `Aria-1.1.0-universal.dmg` and drag Aria into Applications.
2. Open Aria from Applications. The first time, macOS says it can't check the app. Click **Done**.
3. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to Aria. Confirm with your password.
4. Aria opens and asks for the microphone the first time you talk to her. Click **Allow**.
5. The first time you press ⌃⌥A, macOS asks to let Aria see the screen. Turn Aria on in **System Settings → Privacy & Security → Screen & System Audio Recording**. Aria restarts by itself, then ⌃⌥A works.

To also put the icon on the desktop: in Applications, hold Option + Command and drag Aria onto the desktop.

**Windows**

1. Double-click `Aria-Setup-1.1.0.exe`.
2. If a blue "Windows protected your PC" box appears, click **More info → Run anyway**.
3. Click through the installer. It puts an Aria icon on the desktop and in the Start menu.

The warnings appear because the app is not signed with a paid certificate (Apple Developer ID, $99/year; a Windows code-signing certificate). Everything works the same without one.

## Building

```bash
npm install
npm start          # run the app without building an installer
npm test           # launches the app against live Aria and checks it (screenshots in ~/aria-qa-images/desktop-app)
npm run test:screen  # the screen-mark overlay, off screen and free (mock); needs ARIA_URL=http://localhost:3000 and a local Aria
npm run dist:mac   # Mac .dmg
npm run dist:win   # Windows .exe (builds on a Mac too)
```

Change `version` in `package.json` before building a new installer. A new installer is only needed when this folder changes. Website changes reach the app by themselves.

To point the app at another Aria (for example a local one): `ARIA_URL=http://localhost:3000 npm start`.

## What the app does beyond showing the website

- Microphone and camera are allowed for Aria only, and the Mac asks the student once.
- Links to other websites (sources, syllabus pages) open in the normal browser.
- Sign-in with Google, Apple and Microsoft stays in the app, so the student stays signed in.
- With no internet, a "can't connect" screen appears and retries by itself.
- Window size and place are remembered. Copy/paste, zoom, back/forward and full screen work from the menu and keyboard.
- Chrome's own speech recognition does not work outside Chrome, so the app hides it and Aria's voice uses Gemini's listening instead, as it does in Firefox.
- **Screen marks** (`screen.js`): Ctrl+Alt+A (or Ctrl+Alt+M if another app holds it), also in the app menu. A see-through window over the screen takes the mark; clicks pass through it to other apps the rest of the time. The board itself is a page of the Aria website (`frontend/web/public/screen/`), so it uses the app's own sign-in, and its explaining, voice and videos run on the Aria server (`frontend/web/app/api/screen/`), never in the app. `ARIA_SCREEN_MOCK=1 npm start` runs marks with no paid call.
- On Windows, closing Aria's window quits the app. On a Mac, Aria keeps running in the background, so ⌃⌥A still works, until you quit it.

To change the icon, edit `build/icon.svg` and run `npm run icon`.
