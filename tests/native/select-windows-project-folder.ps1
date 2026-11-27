param(
    [Parameter(Mandatory=$true)][int]$OwnerProcess,
    [Parameter(Mandatory=$true)][string]$Title,
    [string]$Folder,
    [switch]$Cancel
)
$ErrorActionPreference = 'Stop'
if (!$Cancel -and (!$Folder -or !(Test-Path -LiteralPath $Folder -PathType Container))) { throw 'The fixture folder must exist.' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeProjectDialog {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr window);
    [StructLayout(LayoutKind.Sequential)]
    public struct GuiThreadInfo {
        public uint size, flags;
        public IntPtr active, focus, capture, menuOwner, moveSize, caret;
        public int left, top, right, bottom;
    }
    [DllImport("user32.dll")]
    public static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
}
'@

$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
    $handle = [NativeProjectDialog]::FindWindow([NullString]::Value, $Title)
    [uint32]$actualProcess = 0
    if ($handle -ne [IntPtr]::Zero) {
        $thread = [NativeProjectDialog]::GetWindowThreadProcessId($handle, [ref]$actualProcess)
    }
    if ($actualProcess -ne $OwnerProcess) { Start-Sleep -Milliseconds 100 }
} until ($actualProcess -eq $OwnerProcess -or [DateTime]::UtcNow -ge $deadline)
if ($actualProcess -ne $OwnerProcess) { throw "Native folder dialog did not open: $Title" }
$parent = [NativeProjectDialog]::GetWindow($handle, 4) # GW_OWNER
[uint32]$parentProcess = 0
[void][NativeProjectDialog]::GetWindowThreadProcessId($parent, [ref]$parentProcess)
if ($parentProcess -ne $OwnerProcess) { throw 'The folder dialog has no owner in the fixture editor process.' }
if ($Cancel) {
    $gui = New-Object NativeProjectDialog+GuiThreadInfo
    $gui.size = [Runtime.InteropServices.Marshal]::SizeOf($gui)
    if (![NativeProjectDialog]::GetGUIThreadInfo($thread, [ref]$gui) -or
        ($gui.focus -ne $handle -and ![NativeProjectDialog]::IsChild($handle, $gui.focus))) {
        throw 'The fixture folder dialog does not own keyboard focus.'
    }
    if (![NativeProjectDialog]::PostMessage($gui.focus, 0x100, [IntPtr]27, [IntPtr]0x00010001)) {
        throw 'Could not send Escape to the fixture folder picker.'
    }
    $dismissDeadline = [DateTime]::UtcNow.AddSeconds(5)
    while ([NativeProjectDialog]::IsWindowVisible($handle) -and [DateTime]::UtcNow -lt $dismissDeadline) {
        Start-Sleep -Milliseconds 50
    }
    if ([NativeProjectDialog]::IsWindowVisible($handle)) { throw 'Escape did not dismiss the fixture folder picker.' }
    return
}
# Confirm the owned, already-open native picker without sending global input.
if (![NativeProjectDialog]::PostMessage($handle, 0x111, [IntPtr]1, [IntPtr]0)) {
    throw 'Could not confirm the native folder picker.'
}
