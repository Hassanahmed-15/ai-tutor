# Real Windows input for the screen-mark probe (test/win-probe.js): presses a key chord or drags a
# circle with the real mouse, through user32 like a person would.
#   powershell -File win-input.ps1 keys          -> Ctrl+Alt+A
#   powershell -File win-input.ps1 circle X Y R  -> a circle of radius R round (X, Y)
#   powershell -File win-input.ps1 click X Y
param([string]$what, [int]$x = 0, [int]$y = 0, [int]$r = 0)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class U {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[U]::SetProcessDPIAware() | Out-Null
$DOWN = 0x0002; $UP = 0x0004
if ($what -eq "keys") {
  $CTRL = 0x11; $ALT = 0x12; $A = 0x41
  [U]::keybd_event($CTRL, 0, 0, [UIntPtr]::Zero); [U]::keybd_event($ALT, 0, 0, [UIntPtr]::Zero)
  [U]::keybd_event($A, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60
  [U]::keybd_event($A, 0, 2, [UIntPtr]::Zero); [U]::keybd_event($ALT, 0, 2, [UIntPtr]::Zero); [U]::keybd_event($CTRL, 0, 2, [UIntPtr]::Zero)
} elseif ($what -eq "circle") {
  [U]::SetCursorPos($x + $r, $y) | Out-Null; Start-Sleep -Milliseconds 80
  [U]::mouse_event($DOWN, 0, 0, 0, [UIntPtr]::Zero)
  for ($i = 1; $i -le 40; $i++) {
    $a = $i / 40 * 2 * [Math]::PI
    [U]::SetCursorPos([int]($x + $r * [Math]::Cos($a)), [int]($y + 0.5 * $r * [Math]::Sin($a))) | Out-Null
    Start-Sleep -Milliseconds 15
  }
  [U]::mouse_event($UP, 0, 0, 0, [UIntPtr]::Zero)
} elseif ($what -eq "click") {
  [U]::SetCursorPos($x, $y) | Out-Null; Start-Sleep -Milliseconds 80
  [U]::mouse_event($DOWN, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60
  [U]::mouse_event($UP, 0, 0, 0, [UIntPtr]::Zero)
}
