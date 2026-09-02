using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace EdgeBrowserThemeToggle.NativeHost;

internal sealed class EdgeAppearanceAutomator
{
    private const byte VkControl = 0x11;
    private const byte VkN = 0x4E;
    private const byte VkW = 0x57;
    private const byte VkReturn = 0x0D;
    private const uint KeyEventKeyUp = 0x0002;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpNoOwnerZOrder = 0x0200;
    private const uint SwpShowWindow = 0x0040;
    private const string AppearanceUrl = "edge://settings/appearance";
    private const string AddressBarAutomationId = "view_1022";

    public NativeResponse Toggle(IntPtr parentWindow)
    {
        if (!TryFindTargetEdgeWindow(parentWindow, out var edgeWindow, out var targetFailure))
        {
            return targetFailure;
        }

        if (!TryActivateWindow(edgeWindow))
        {
            return NativeResponse.Failure(
                "edge-focus-failed",
                "无法激活发起单击的 Edge 窗口，因此未更改外观。");
        }

        TemporaryEdgeWindow? temporaryWindow = null;
        var cleanupSucceeded = true;
        NativeResponse result;
        try
        {
            if (!TemporaryEdgeWindow.TryCreate(edgeWindow, out temporaryWindow, out var createFailure))
            {
                result = createFailure;
            }
            else if (!TryOpenAppearancePage(temporaryWindow!.Handle, out var navigationFailure))
            {
                result = navigationFailure;
            }
            else
            {
                var controls = WaitForAppearanceControls(temporaryWindow.Handle, TimeSpan.FromSeconds(6));
                if (controls is null)
                {
                    result = NativeResponse.Failure(
                        "appearance-page-timeout",
                        "Edge 未在限定时间内显示整体外观控件，未更改外观。");
                }
                else
                {
                    var nextMode = TogglePlan.Next(IsSelected(controls.Dark));
                    var target = nextMode == AppearanceMode.Dark ? controls.Dark : controls.Light;
                    var selection = (SelectionItemPattern)target.GetCurrentPattern(SelectionItemPattern.Pattern);
                    selection.Select();

                    result = WaitForSelection(temporaryWindow.Handle, nextMode, TimeSpan.FromSeconds(4))
                        ? NativeResponse.Success(nextMode)
                        : NativeResponse.Failure(
                            "appearance-selection-failed",
                            "Edge 没有确认新的整体外观，未报告成功。");
                }
            }
        }
        catch (ElementNotAvailableException)
        {
            result = NativeResponse.Failure(
                "appearance-element-unavailable",
                "Edge 外观页在切换过程中不可访问，未报告成功。");
        }
        catch (InvalidOperationException)
        {
            result = NativeResponse.Failure(
                "appearance-automation-failed",
                "无法操作 Edge 的整体外观控件，未报告成功。");
        }
        finally
        {
            if (temporaryWindow is not null)
            {
                cleanupSucceeded = temporaryWindow.Close();
            }

            if (!TryActivateWindow(edgeWindow))
            {
                cleanupSucceeded = false;
            }
        }

        if (cleanupSucceeded)
        {
            return result;
        }

        return NativeResponse.Failure(
            "temporary-window-cleanup-failed",
            result.Ok
                ? "Edge 外观可能已切换，但临时离屏窗口未能安全关闭或原窗口未能恢复焦点。"
                : "临时离屏窗口未能安全关闭或原窗口未能恢复焦点；未报告外观切换成功。");
    }

    private static bool TryFindTargetEdgeWindow(
        IntPtr preferredWindow,
        out IntPtr edgeWindow,
        out NativeResponse failure)
    {
        if (preferredWindow != IntPtr.Zero)
        {
            if (IsVisibleEdgeWindow(preferredWindow))
            {
                edgeWindow = preferredWindow;
                failure = default!;
                return true;
            }

            edgeWindow = IntPtr.Zero;
            failure = NativeResponse.Failure(
                "edge-parent-window-invalid",
                "发起单击的 Edge 窗口已不可用，因此未更改外观。");
            return false;
        }

        var foreground = NativeMethods.GetForegroundWindow();
        if (IsVisibleEdgeWindow(foreground))
        {
            edgeWindow = foreground;
            failure = default!;
            return true;
        }

        var candidates = SnapshotVisibleEdgeWindows();
        if (candidates.Count == 1)
        {
            edgeWindow = candidates[0];
            failure = default!;
            return true;
        }

        edgeWindow = IntPtr.Zero;
        failure = candidates.Count == 0
            ? NativeResponse.Failure(
                "edge-window-not-found",
                "未找到已打开的 Edge 窗口，因此未更改外观。")
            : NativeResponse.Failure(
                "edge-window-ambiguous",
                "检测到多个 Edge 窗口；请在要切换的窗口中单击图标。");
        return false;
    }

    private static bool TryOpenAppearancePage(IntPtr edgeWindow, out NativeResponse failure)
    {
        try
        {
            if (!TryActivateWindow(edgeWindow))
            {
                failure = NativeResponse.Failure(
                    "temporary-window-focus-failed",
                    "无法激活临时离屏 Edge 窗口，因此未更改外观。");
                return false;
            }

            var addressBar = WaitForAddressBar(edgeWindow, TimeSpan.FromSeconds(2));
            if (addressBar is null)
            {
                failure = NativeResponse.Failure(
                    "address-bar-not-found",
                    "未能定位临时 Edge 窗口的地址栏，未更改外观。");
                return false;
            }

            addressBar.SetFocus();
            var value = (ValuePattern)addressBar.GetCurrentPattern(ValuePattern.Pattern);
            if (value.Current.IsReadOnly)
            {
                failure = NativeResponse.Failure(
                    "address-bar-read-only",
                    "临时 Edge 窗口的地址栏不可写入，未更改外观。");
                return false;
            }

            value.SetValue(AppearanceUrl);
            if (!SendKey(VkReturn))
            {
                failure = NativeResponse.Failure(
                    "navigation-input-failed",
                    "无法向临时 Edge 窗口发送导航操作，未更改外观。");
                return false;
            }

            failure = default!;
            return true;
        }
        catch (ElementNotAvailableException)
        {
            failure = NativeResponse.Failure(
                "address-bar-unavailable",
                "Edge 地址栏在导航时不可访问，未更改外观。");
            return false;
        }
        catch (InvalidOperationException)
        {
            failure = NativeResponse.Failure(
                "address-bar-navigation-failed",
                "无法通过临时 Edge 窗口的地址栏打开外观页，未更改外观。");
            return false;
        }
    }

    private static AutomationElement? WaitForAddressBar(IntPtr edgeWindow, TimeSpan timeout)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < timeout)
        {
            try
            {
                var root = AutomationElement.FromHandle(edgeWindow);
                var addressBar = FindByAutomationId(root, AddressBarAutomationId);
                if (addressBar is not null)
                {
                    return addressBar;
                }
            }
            catch (ElementNotAvailableException)
            {
                // The new window can still be materializing its toolbar; retry until timeout.
            }

            Thread.Sleep(50);
        }

        return null;
    }

    private static AppearanceControls? WaitForAppearanceControls(IntPtr edgeWindow, TimeSpan timeout)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < timeout)
        {
            var controls = FindAppearanceControls(edgeWindow);
            if (controls is not null)
            {
                return controls;
            }

            Thread.Sleep(75);
        }

        return FindAppearanceControls(edgeWindow);
    }

    private static bool WaitForSelection(IntPtr edgeWindow, AppearanceMode target, TimeSpan timeout)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < timeout)
        {
            var controls = FindAppearanceControls(edgeWindow);
            var element = target == AppearanceMode.Dark ? controls?.Dark : controls?.Light;
            if (element is not null && IsSelected(element))
            {
                return true;
            }

            Thread.Sleep(75);
        }

        return false;
    }

    private static AppearanceControls? FindAppearanceControls(IntPtr edgeWindow)
    {
        try
        {
            var root = AutomationElement.FromHandle(edgeWindow);
            var group = FindByAutomationId(root, "appearance-mode-radio-group");
            var light = FindByAutomationId(root, "light");
            var dark = FindByAutomationId(root, "dark");
            return group is not null && light is not null && dark is not null
                ? new AppearanceControls(light, dark)
                : null;
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }
    }

    private static AutomationElement? FindByAutomationId(AutomationElement root, string automationId) =>
        root.FindFirst(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, automationId));

    private static bool IsSelected(AutomationElement element)
    {
        var selection = (SelectionItemPattern)element.GetCurrentPattern(SelectionItemPattern.Pattern);
        return selection.Current.IsSelected;
    }

    private static int? GetTabCount(IntPtr edgeWindow)
    {
        try
        {
            var root = AutomationElement.FromHandle(edgeWindow);
            return root.FindAll(
                    TreeScope.Descendants,
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem))
                .Count;
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }
    }

    private static bool WaitForTabCount(IntPtr edgeWindow, int expectedCount, TimeSpan timeout)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < timeout)
        {
            if (GetTabCount(edgeWindow) == expectedCount)
            {
                return true;
            }

            Thread.Sleep(50);
        }

        return GetTabCount(edgeWindow) == expectedCount;
    }

    private static bool IsVisibleEdgeWindow(IntPtr window)
    {
        if (window == IntPtr.Zero ||
            !NativeMethods.IsWindow(window) ||
            !NativeMethods.IsWindowVisible(window))
        {
            return false;
        }

        NativeMethods.GetWindowThreadProcessId(window, out var processId);
        if (processId == 0)
        {
            return false;
        }

        try
        {
            using var process = Process.GetProcessById((int)processId);
            return string.Equals(process.ProcessName, "msedge", StringComparison.OrdinalIgnoreCase) &&
                   NativeMethods.GetWindowTextLength(window) > 0;
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    private static List<IntPtr> SnapshotVisibleEdgeWindows()
    {
        var candidates = new List<IntPtr>();
        NativeMethods.EnumWindows((window, _) =>
        {
            if (IsVisibleEdgeWindow(window))
            {
                candidates.Add(window);
            }

            return true;
        }, IntPtr.Zero);
        return candidates;
    }

    private static bool TryActivateWindow(IntPtr window)
    {
        NativeMethods.SetForegroundWindow(window);
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < TimeSpan.FromMilliseconds(500))
        {
            if (NativeMethods.GetForegroundWindow() == window)
            {
                return true;
            }

            Thread.Sleep(20);
        }

        return NativeMethods.GetForegroundWindow() == window;
    }

    private static bool SendControlShortcut(byte key) => SendVirtualKeys(
        new VirtualKey(VkControl, 0),
        new VirtualKey(key, 0),
        new VirtualKey(key, KeyEventKeyUp),
        new VirtualKey(VkControl, KeyEventKeyUp));

    private static bool SendKey(byte key) => SendVirtualKeys(
        new VirtualKey(key, 0),
        new VirtualKey(key, KeyEventKeyUp));

    private static bool SendVirtualKeys(params VirtualKey[] keys)
    {
        var input = new NativeMethods.Input[keys.Length];
        for (var index = 0; index < keys.Length; index++)
        {
            input[index] = NativeMethods.Input.FromVirtualKey(keys[index].Key, keys[index].Flags);
        }

        return NativeMethods.SendInput(
            (uint)input.Length,
            input,
            Marshal.SizeOf<NativeMethods.Input>()) == input.Length;
    }

    private sealed record AppearanceControls(AutomationElement Light, AutomationElement Dark);
    private readonly record struct VirtualKey(byte Key, uint Flags);

    private sealed class TemporaryEdgeWindow
    {
        private readonly IntPtr parentWindow;
        private readonly uint expectedProcessId;
        private readonly WindowBounds originalBounds;

        private TemporaryEdgeWindow(
            IntPtr handle,
            IntPtr parentWindow,
            uint expectedProcessId,
            WindowBounds originalBounds)
        {
            Handle = handle;
            this.parentWindow = parentWindow;
            this.expectedProcessId = expectedProcessId;
            this.originalBounds = originalBounds;
        }

        public IntPtr Handle { get; }

        public static bool TryCreate(
            IntPtr parentWindow,
            out TemporaryEdgeWindow? temporaryWindow,
            out NativeResponse failure)
        {
            temporaryWindow = null;
            NativeMethods.GetWindowThreadProcessId(parentWindow, out var parentProcessId);
            if (parentProcessId == 0)
            {
                failure = NativeResponse.Failure(
                    "edge-process-not-found",
                    "无法确认目标 Edge 进程，因此未创建临时窗口。");
                return false;
            }

            var existingWindows = SnapshotVisibleEdgeWindows().ToHashSet();
            if (!TryActivateWindow(parentWindow) || !SendControlShortcut(VkN))
            {
                failure = NativeResponse.Failure(
                    "temporary-window-create-failed",
                    "无法创建临时离屏 Edge 窗口，未更改外观。");
                return false;
            }

            var candidate = WaitForNewWindow(existingWindows, parentProcessId, TimeSpan.FromSeconds(3));
            if (candidate == IntPtr.Zero || !NativeMethods.GetWindowRect(candidate, out var rectangle))
            {
                failure = NativeResponse.Failure(
                    "temporary-window-not-found",
                    "Edge 未确认临时离屏窗口已创建，未更改外观。");
                return false;
            }

            var originalBounds = WindowBounds.From(rectangle);
            var created = new TemporaryEdgeWindow(candidate, parentWindow, parentProcessId, originalBounds);
            if (!NativeMethods.SetWindowPos(
                    candidate,
                    IntPtr.Zero,
                    -32000,
                    -32000,
                    1000,
                    800,
                    SwpNoActivate | SwpNoOwnerZOrder | SwpShowWindow))
            {
                _ = created.Close();
                failure = NativeResponse.Failure(
                    "temporary-window-offscreen-failed",
                    "无法将临时 Edge 窗口移出屏幕，未更改外观。");
                return false;
            }

            if (!WaitForTabCount(candidate, 1, TimeSpan.FromSeconds(2)))
            {
                _ = created.Close();
                failure = NativeResponse.Failure(
                    "temporary-window-unsafe",
                    "临时 Edge 窗口不符合单标签页安全条件，未更改外观。");
                return false;
            }

            temporaryWindow = created;
            failure = default!;
            return true;
        }

        public bool Close()
        {
            if (!NativeMethods.IsWindow(Handle))
            {
                return true;
            }

            NativeMethods.GetWindowThreadProcessId(Handle, out var processId);
            if (processId != expectedProcessId || GetTabCount(Handle) != 1 || !TryActivateWindow(Handle))
            {
                RestoreOriginalPosition();
                return false;
            }

            if (!SendControlShortcut(VkW))
            {
                RestoreOriginalPosition();
                return false;
            }

            var stopwatch = Stopwatch.StartNew();
            while (stopwatch.Elapsed < TimeSpan.FromSeconds(3))
            {
                if (!NativeMethods.IsWindow(Handle))
                {
                    return true;
                }

                Thread.Sleep(40);
            }

            RestoreOriginalPosition();
            return !NativeMethods.IsWindow(Handle);
        }

        private static IntPtr WaitForNewWindow(
            HashSet<IntPtr> existingWindows,
            uint expectedProcessId,
            TimeSpan timeout)
        {
            var stopwatch = Stopwatch.StartNew();
            while (stopwatch.Elapsed < timeout)
            {
                foreach (var window in SnapshotVisibleEdgeWindows())
                {
                    if (existingWindows.Contains(window))
                    {
                        continue;
                    }

                    NativeMethods.GetWindowThreadProcessId(window, out var processId);
                    if (processId == expectedProcessId)
                    {
                        return window;
                    }
                }

                Thread.Sleep(40);
            }

            return IntPtr.Zero;
        }

        private void RestoreOriginalPosition()
        {
            if (NativeMethods.IsWindow(Handle))
            {
                NativeMethods.SetWindowPos(
                    Handle,
                    IntPtr.Zero,
                    originalBounds.Left,
                    originalBounds.Top,
                    originalBounds.Width,
                    originalBounds.Height,
                    SwpNoActivate | SwpNoOwnerZOrder | SwpShowWindow);
            }

            TryActivateWindow(parentWindow);
        }
    }

    private readonly record struct WindowBounds(int Left, int Top, int Width, int Height)
    {
        public static WindowBounds From(NativeMethods.Rectangle rectangle) => new(
            rectangle.Left,
            rectangle.Top,
            rectangle.Right - rectangle.Left,
            rectangle.Bottom - rectangle.Top);
    }

    private static class NativeMethods
    {
        internal delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

        [DllImport("user32.dll")]
        internal static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetForegroundWindow(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsWindow(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll")]
        internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern int GetWindowTextLength(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetWindowRect(IntPtr window, out Rectangle rectangle);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetWindowPos(
            IntPtr window,
            IntPtr insertAfter,
            int x,
            int y,
            int width,
            int height,
            uint flags);

        [DllImport("user32.dll", SetLastError = true)]
        internal static extern uint SendInput(uint count, Input[] input, int inputSize);

        [StructLayout(LayoutKind.Sequential)]
        internal struct Rectangle
        {
            internal int Left;
            internal int Top;
            internal int Right;
            internal int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct Input
        {
            internal uint Type;
            internal InputUnion Union;

            internal static Input FromVirtualKey(byte key, uint flags) => new()
            {
                Type = 1,
                Union = new InputUnion
                {
                    Keyboard = new KeyboardInput
                    {
                        VirtualKey = key,
                        Flags = flags,
                    },
                },
            };
        }

        [StructLayout(LayoutKind.Explicit, Size = 32)]
        internal struct InputUnion
        {
            [FieldOffset(0)]
            internal KeyboardInput Keyboard;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct KeyboardInput
        {
            internal ushort VirtualKey;
            internal ushort ScanCode;
            internal uint Flags;
            internal uint Time;
            internal IntPtr ExtraInfo;
        }
    }
}
