using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace EdgeBrowserThemeToggle.NativeHost;

internal sealed class EdgeAppearanceAutomator
{
    private const string AppearanceGroupAutomationId = "appearance-mode-radio-group";
    private const string LightAutomationId = "light";
    private const string DarkAutomationId = "dark";
    private const string BrowserAppMenuButtonAutomationId = "view_1016";
    private const string BrowserAppMenuButtonClassName = "BrowserAppMenuButton";

    public NativeResponse Toggle(IntPtr preferredWindow)
    {
        if (!TryFindTargetEdgeWindow(preferredWindow, out var edgeWindow, out var targetFailure))
        {
            return targetFailure;
        }

        var navigationFailure = NavigateToAppearance(edgeWindow);
        if (navigationFailure is not null)
        {
            return navigationFailure;
        }

        var controls = WaitForAppearanceControls(edgeWindow, TimeSpan.FromSeconds(8));
        if (controls is null)
        {
            return NativeResponse.Failure(
                "appearance-page-timeout",
                "Edge 外观控件未在限定时间内可访问，未更改外观。");
        }

        bool isDark;
        bool isLight;
        try
        {
            isDark = IsSelected(controls.Dark);
            isLight = IsSelected(controls.Light);
        }
        catch (ElementNotAvailableException)
        {
            return NativeResponse.Failure(
                "appearance-element-unavailable",
                "Edge 外观控件在切换过程中不可访问，未更改外观。");
        }
        catch (InvalidOperationException)
        {
            return NativeResponse.Failure(
                "appearance-selection-unavailable",
                "无法读取 Edge 当前整体外观，未更改外观。");
        }

        if (isDark == isLight)
        {
            return NativeResponse.Failure(
                "appearance-selection-ambiguous",
                "Edge 没有报告唯一的整体外观选项，未更改外观。");
        }

        var nextMode = TogglePlan.Next(isDark);
        var target = nextMode == AppearanceMode.Dark ? controls.Dark : controls.Light;
        try
        {
            var selection = (SelectionItemPattern)target.GetCurrentPattern(
                SelectionItemPattern.Pattern);
            selection.Select();
        }
        catch (ElementNotAvailableException)
        {
            return NativeResponse.Failure(
                "appearance-element-unavailable",
                "Edge 外观控件在切换过程中不可访问，未更改外观。");
        }
        catch (InvalidOperationException)
        {
            return NativeResponse.Failure(
                "appearance-selection-failed",
                "无法操作 Edge 的整体外观控件，未更改外观。");
        }

        return WaitForSelection(edgeWindow, nextMode, target, TimeSpan.FromSeconds(4))
            ? NativeResponse.Success(nextMode)
            : NativeResponse.Failure(
                "appearance-selection-unconfirmed",
                "Edge 没有确认新的整体外观，未报告成功。");
    }

    private static NativeResponse? NavigateToAppearance(IntPtr edgeWindow)
    {
        if (FindAppearanceControls(edgeWindow) is not null)
        {
            return null;
        }

        var settingsItem = FindSettingsMenuItem(edgeWindow);
        if (settingsItem is null)
        {
            var appMenu = WaitForElement(
                () => FindBrowserAppMenuButton(edgeWindow),
                TimeSpan.FromSeconds(3));
            if (appMenu is null || !TryOpenBrowserAppMenu(appMenu))
            {
                return NativeResponse.Failure(
                    "edge-app-menu-unavailable",
                    "无法打开 Edge 应用菜单，因此未更改外观。");
            }

            settingsItem = WaitForElement(
                () => FindSettingsMenuItem(edgeWindow),
                TimeSpan.FromSeconds(3));
        }

        if (settingsItem is null)
        {
            return NativeResponse.Failure(
                "edge-settings-menu-item-unavailable",
                "无法在 Edge 应用菜单中找到设置入口，因此未更改外观。");
        }

        if (!TryInvoke(settingsItem))
        {
            return NativeResponse.Failure(
                "edge-settings-open-failed",
                "无法打开 Edge 设置，因此未更改外观。");
        }

        var appearanceNavigation = WaitForElement(
            () => FindAppearanceNavigation(edgeWindow),
            TimeSpan.FromSeconds(8));
        if (appearanceNavigation is null || !TryInvoke(appearanceNavigation))
        {
            return NativeResponse.Failure(
                "edge-appearance-navigation-failed",
                "无法打开 Edge 外观设置，因此未更改外观。");
        }

        return null;
    }

    private static AutomationElement? FindBrowserAppMenuButton(IntPtr edgeWindow)
    {
        try
        {
            var root = AutomationElement.FromHandle(edgeWindow);
            return root.FindFirst(
                       TreeScope.Descendants,
                       new PropertyCondition(
                           AutomationElement.AutomationIdProperty,
                           BrowserAppMenuButtonAutomationId))
                   ?? root.FindFirst(
                       TreeScope.Descendants,
                       new PropertyCondition(
                           AutomationElement.ClassNameProperty,
                           BrowserAppMenuButtonClassName));
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }
    }

    private static AutomationElement? FindSettingsMenuItem(IntPtr edgeWindow)
    {
        try
        {
            var root = AutomationElement.FromHandle(edgeWindow);
            var items = root.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(
                    AutomationElement.ControlTypeProperty,
                    ControlType.MenuItem));
            foreach (AutomationElement item in items)
            {
                var name = item.Current.Name;
                if (name.StartsWith("设置", StringComparison.OrdinalIgnoreCase) ||
                    name.StartsWith("Settings", StringComparison.OrdinalIgnoreCase))
                {
                    return item;
                }
            }
        }
        catch (ElementNotAvailableException)
        {
            // The application menu can be replaced while it is opening.
        }

        return null;
    }

    private static AutomationElement? FindAppearanceNavigation(IntPtr edgeWindow)
    {
        try
        {
            var root = AutomationElement.FromHandle(edgeWindow);
            var radios = root.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(
                    AutomationElement.ControlTypeProperty,
                    ControlType.RadioButton));
            foreach (AutomationElement radio in radios)
            {
                var name = radio.Current.Name;
                if (string.Equals(name, "外观", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(name, "Appearance", StringComparison.OrdinalIgnoreCase))
                {
                    return radio;
                }
            }
        }
        catch (ElementNotAvailableException)
        {
            // The settings page can be replaced while it is loading.
        }

        return null;
    }

    private static AutomationElement? WaitForElement(
        Func<AutomationElement?> find,
        TimeSpan timeout)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < timeout)
        {
            try
            {
                var element = find();
                if (element is not null)
                {
                    return element;
                }
            }
            catch (ElementNotAvailableException)
            {
                // Retry while Edge replaces the WebUI tree.
            }

            Thread.Sleep(60);
        }

        try
        {
            return find();
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private static bool TryOpenBrowserAppMenu(AutomationElement appMenu)
    {
        return TryClickCenter(appMenu) || TryInvoke(appMenu);
    }

    private static bool TryInvoke(AutomationElement element)
    {
        try
        {
            var invoke = (InvokePattern)element.GetCurrentPattern(InvokePattern.Pattern);
            invoke.Invoke();
            return true;
        }
        catch (ElementNotAvailableException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    private static bool TryClickCenter(AutomationElement element)
    {
        var hasOriginalCursor = false;
        NativeMethods.Point originalCursor = default;
        try
        {
            var bounds = element.Current.BoundingRectangle;
            if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0 ||
                !NativeMethods.GetCursorPos(out originalCursor))
            {
                return false;
            }

            hasOriginalCursor = true;

            var centerX = (int)Math.Round(bounds.Left + bounds.Width / 2);
            var centerY = (int)Math.Round(bounds.Top + bounds.Height / 2);
            if (!NativeMethods.SetCursorPos(centerX, centerY))
            {
                return false;
            }

            NativeMethods.MouseClick();
            return true;
        }
        catch (ElementNotAvailableException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
        finally
        {
            if (hasOriginalCursor)
            {
                NativeMethods.SetCursorPos(originalCursor.X, originalCursor.Y);
            }
        }
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

            Thread.Sleep(60);
        }

        return FindAppearanceControls(edgeWindow);
    }

    private static bool WaitForSelection(
        IntPtr edgeWindow,
        AppearanceMode mode,
        AutomationElement target,
        TimeSpan timeout)
    {
        var stopwatch = Stopwatch.StartNew();
        while (stopwatch.Elapsed < timeout)
        {
            try
            {
                if (IsSelected(target))
                {
                    return true;
                }
            }
            catch (ElementNotAvailableException)
            {
                // The WebUI can replace the radio elements after the preference write.
            }
            catch (InvalidOperationException)
            {
                // The WebUI can temporarily remove the radio pattern while re-rendering.
            }

            Thread.Sleep(60);
        }

        var refreshed = FindAppearanceControls(edgeWindow);
        var refreshedTarget = refreshed is null
            ? null
            : mode == AppearanceMode.Dark ? refreshed.Dark : refreshed.Light;
        try
        {
            return refreshedTarget is not null && IsSelected(refreshedTarget);
        }
        catch (ElementNotAvailableException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    private static AppearanceControls? FindAppearanceControls(IntPtr edgeWindow)
    {
        try
        {
            var root = AutomationElement.FromHandle(edgeWindow);
            var group = FindByAutomationId(root, AppearanceGroupAutomationId);
            var light = FindByAutomationId(root, LightAutomationId);
            var dark = FindByAutomationId(root, DarkAutomationId);
            return group is not null && light is not null && dark is not null
                ? new AppearanceControls(light, dark)
                : null;
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private static AutomationElement? FindByAutomationId(
        AutomationElement root,
        string automationId) => root.FindFirst(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, automationId));

    private static bool IsSelected(AutomationElement element)
    {
        var selection = (SelectionItemPattern)element.GetCurrentPattern(
            SelectionItemPattern.Pattern);
        return selection.Current.IsSelected;
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
                "检测到多个 Edge 窗口，因此未更改外观。");
        return false;
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

    private sealed record AppearanceControls(AutomationElement Light, AutomationElement Dark);

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
        internal static extern bool GetCursorPos(out Point point);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll")]
        private static extern void mouse_event(
            uint flags,
            uint x,
            uint y,
            uint data,
            UIntPtr extraInfo);

        internal static void MouseClick()
        {
            const uint leftDown = 0x0002;
            const uint leftUp = 0x0004;
            mouse_event(leftDown, 0, 0, 0, UIntPtr.Zero);
            mouse_event(leftUp, 0, 0, 0, UIntPtr.Zero);
        }

        [StructLayout(LayoutKind.Sequential)]
        internal readonly struct Point
        {
            internal readonly int X;
            internal readonly int Y;
        }
    }
}
