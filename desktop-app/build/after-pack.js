// Gives the Mac app a free "ad-hoc" signature. Without any signature, a downloaded app on an
// Apple-chip Mac is reported as "damaged" and cannot be opened at all. With one, macOS only asks
// once whether to trust it. (A $99/year Apple Developer ID would remove even that question.)
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  // A universal build packs each chip's copy in a "-temp" folder first; only the merged app is signed.
  if (context.appOutDir.endsWith("-temp")) return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`  • ad-hoc signed  ${appPath}`);
};
