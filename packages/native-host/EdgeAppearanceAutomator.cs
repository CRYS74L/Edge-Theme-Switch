using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace EdgeBrowserThemeToggle.NativeHost;

internal sealed class EdgeAppearanceAutomator
{
    private const byte VkControl = 0x11;
    private const byte VkT = 0x54;
    private const byte VkW = 0x57;
    private const byte VkReturn = 0x0D;
    private const uint KeyEventKeyUp = 0x0002;
    private const string AppearanceUrl = "edge://settings/appearance";
    private const string AddressBarAutomationId = "view_1022";
    private const int PostCloseVisualSettleMilliseconds = 850;

    public NativeResponse Toggle()
    {
        if (!TryFindTargetEdgeWindow(out var edgeWindow, out var targetFailure))
        {
            return targetFailure;
        }

        if (!TryActivateEdgeWindow(edgeWindow))
        {
            return NativeResponse.Failure(
                "edge-focus-failed",
                "无法激活当前 Edge 窗口，因此未更改外观。请在目标 Edge 窗口中再次单击图标。");
        }

        TemporaryTab? temporaryTab = null;
        WindowSnapshotOverlay? visualOverlay = null;
        var cleanupSucceeded = true;
        NativeResponse result;
        try
        {
            if (!WindowSnapshotOverlay.TryShow(edgeWindow, out visualOverlay, out var visualIsolationFailure))
            {
                result = visualIsolationFailure;
            }
            else
            {
                if (!TryOpenAppearanceTab(edgeWindow, out temporaryTab, out var navigationFailure))
                {
                    result = navigationFailure;
                }
                else
                {
                    var controls = WaitForAppearanceControls(edgeWindow, TimeSpan.FromSeconds(6));
                    if (controls is null)
                    {
                        result = NativeResponse.Failure(
                            "appearance-page-timeout",
                            "Edge 未在限定时间内显示整体外观控件，未更改外观。");
                    }
                    else
                    {
                        var isDark = IsSelected(controls.Dark);
                        var nextMode = TogglePlan.Next(isDark);
                        var target = nextMode == AppearanceMode.Dark ? controls.Dark : controls.Light;

                        var selection = (SelectionItemPattern)target.GetCurrentPattern(SelectionItemPattern.Pattern);
                        selection.Select();

                        result = WaitForSelection(edgeWindow, nextMode, TimeSpan.FromSeconds(4))
                            ? NativeResponse.Success(nextMode)
                            : NativeResponse.Failure(
                                "appearance-selection-failed",
                                "Edge 没有确认新的整体外观，未报告成功。");
                    }
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
                "无法操作 Edge 的整体外观控件，未更改外观。");
        }
        finally
        {
            if (temporaryTab is not null)
            {
                cleanupSucceeded = CloseTemporaryTab(edgeWindow, temporaryTab);
            }

            visualOverlay?.Dispose();
        }

        return cleanupSucceeded
            ? result
            : NativeResponse.Failure(
                "temporary-tab-cleanup-failed",
                "已终止本次切换，因为临时标签页未能安全还原；未报告成功。");
    }

    private static bool TryFindTargetEdgeWindow(out IntPtr edgeWindow, out NativeResponse failure)
    {
        var foreground = NativeMethods.GetForegroundWindow();
        if (IsVisibleEdgeWindow(foreground))
        {
            edgeWindow = foreground;
            failure = default!;
            return true;
        }

        var candidates = new List<IntPtr>();
        NativeMethods.EnumWindows((window, _) =>
        {
            if (IsVisibleEdgeWindow(window))
            {
                candidates.Add(window);
            }

            return true;
        }, IntPtr.Zero);

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

    private static bool IsVisibleEdgeWindow(IntPtr window)
    {
        if (window == IntPtr.Zero || !NativeMethods.IsWindowVisible(window))
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

    private static bool TryActivateEdgeWindow(IntPtr edgeWindow)
    {
        NativeMethods.SetForegroundWindow(edgeWindow);
        Thread.Sleep(120);
        return NativeMethods.GetForegroundWindow() == edgeWindow;
    }

    private static bool TryOpenAppearanceTab(IntPtr edgeWindow, out TemporaryTab? temporaryTab, out NativeResponse failure)
    {
        temporaryTab = null;
        try
        {
            var originalTabCount = GetTabCount(edgeWindow);
            if (originalTabCount is null)
            {
                failure = NativeResponse.Failure(
                    "tab-strip-not-found",
                    "无法确认当前 Edge 标签页状态，因此未开始临时导航。");
                return false;
            }

            var originalActiveTabName = GetSelectedTabName(edgeWindow);

            SendControlShortcut(VkT);
            if (!WaitForTabCount(edgeWindow, originalTabCount.Value + 1, TimeSpan.FromSeconds(2)))
            {
                failure = NativeResponse.Failure(
                    "temporary-tab-not-created",
                    "Edge 未确认临时标签页已创建，因此未更改外观。");
                return false;
            }

            temporaryTab = new TemporaryTab(originalTabCount.Value, originalActiveTabName);
            var addressBar = WaitForAddressBar(edgeWindow, TimeSpan.FromSeconds(2));
            if (addressBar is null)
            {
                failure = NativeResponse.Failure(
                    "address-bar-not-found",
                    "未能定位当前 Edge 的地址栏，未更改外观。");
                return false;
            }

            var value = (ValuePattern)addressBar.GetCurrentPattern(ValuePattern.Pattern);
            if (value.Current.IsReadOnly)
            {
                failure = NativeResponse.Failure(
                    "address-bar-read-only",
                    "当前 Edge 地址栏不可写入，未更改外观。");
                return false;
            }

            value.SetValue(AppearanceUrl);
            SendKey(VkReturn);
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
                "无法通过当前 Edge 地址栏打开外观页，未更改外观。");
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
                // Edge is still materializing the temporary tab; retry until timeout.
            }

            Thread.Sleep(50);
        }

        return null;
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
            var tabCount = GetTabCount(edgeWindow);
            if (tabCount == expectedCount)
            {
                return true;
            }

            Thread.Sleep(50);
        }

        return GetTabCount(edgeWindow) == expectedCount;
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

    private static bool CloseTemporaryTab(IntPtr edgeWindow, TemporaryTab temporaryTab)
    {
        if (NativeMethods.GetForegroundWindow() != edgeWindow && !TryActivateEdgeWindow(edgeWindow))
        {
            return false;
        }

        SendControlShortcut(VkW);
        if (!WaitForTabCount(edgeWindow, temporaryTab.OriginalTabCount, TimeSpan.FromSeconds(2)))
        {
            return false;
        }

        WaitForOriginalViewToBecomeActive(edgeWindow, temporaryTab.OriginalActiveTabName, TimeSpan.FromSeconds(1));

        // Edge can report the tab count before its compositor has repainted the
        // restored tab. The snapshot overlay remains in front during this short
        // settling interval, then disappears directly into the final appearance.
        Thread.Sleep(PostCloseVisualSettleMilliseconds);
        return true;
    }

    private static void WaitForOriginalViewToBecomeActive(
        IntPtr edgeWindow,
        string? originalActiveTabName,
        TimeSpan timeout)
    {
        if (string.IsNullOrEmpty(originalActiveTabName))
        {
            return;
        }

        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < timeout)
        {
            if (string.Equals(GetSelectedTabName(edgeWindow), originalActiveTabName, StringComparison.Ordinal))
            {
                return;
            }

            Thread.Sleep(50);
        }
    }

    private static string? GetSelectedTabName(IntPtr edgeWindow)
    {
        try
        {
            var root = AutomationElement.FromHandle(edgeWindow);
            var tabs = root.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem));
            foreach (AutomationElement tab in tabs)
            {
                if (tab.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var pattern) &&
                    pattern is SelectionItemPattern selection &&
                    selection.Current.IsSelected)
                {
                    return tab.Current.Name;
                }
            }
        }
        catch (ElementNotAvailableException)
        {
            // The tab strip can be rebuilt while a new tab opens; retry callers
            // tolerate an unavailable snapshot.
        }
        catch (InvalidOperationException)
        {
            // A tab without the selection pattern is not useful for restoration.
        }

        return null;
    }

    private static void SendControlShortcut(byte key)
    {
        KeyDown(VkControl);
        SendKey(key);
        KeyUp(VkControl);
    }

    private static void SendKey(byte key)
    {
        KeyDown(key);
        KeyUp(key);
    }

    private static void KeyDown(byte key) =>
        NativeMethods.KeybdEvent(key, 0, 0, UIntPtr.Zero);

    private static void KeyUp(byte key) =>
        NativeMethods.KeybdEvent(key, 0, KeyEventKeyUp, UIntPtr.Zero);

    private sealed record AppearanceControls(AutomationElement Light, AutomationElement Dark);
    private sealed record TemporaryTab(int OriginalTabCount, string? OriginalActiveTabName);

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
        internal static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll")]
        internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        internal static extern int GetWindowTextLength(IntPtr window);

        [DllImport("user32.dll", EntryPoint = "keybd_event")]
        internal static extern void KeybdEvent(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

    }
}
