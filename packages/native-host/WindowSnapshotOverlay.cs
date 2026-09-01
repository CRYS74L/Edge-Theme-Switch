using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace EdgeBrowserThemeToggle.NativeHost;

/// <summary>
/// Keeps the current Edge frame visually stable while the browser updates its
/// own internal appearance preference. The overlay is an opaque screenshot of
/// the exact target window; it never owns focus or appears in the taskbar.
/// </summary>
internal sealed class WindowSnapshotOverlay : IDisposable
{
    private const int StartupTimeoutMilliseconds = 2_000;
    private const int CloseTimeoutMilliseconds = 2_000;

    private readonly Bitmap snapshot;
    private readonly Rectangle overlayBounds;
    private readonly IntPtr targetEdgeWindow;
    private readonly ManualResetEventSlim shown = new(false);
    private readonly ManualResetEventSlim closed = new(false);
    private readonly object gate = new();
    private Exception? startupError;
    private SnapshotForm? form;
    private Thread? uiThread;
    private bool disposed;

    private WindowSnapshotOverlay(Bitmap snapshot, Rectangle overlayBounds, IntPtr targetEdgeWindow)
    {
        this.snapshot = snapshot;
        this.overlayBounds = overlayBounds;
        this.targetEdgeWindow = targetEdgeWindow;
    }

    public static bool TryShow(IntPtr edgeWindow, out WindowSnapshotOverlay? overlay, out NativeResponse failure)
    {
        overlay = null;
        if (!NativeMethods.GetWindowRect(edgeWindow, out var nativeBounds))
        {
            failure = NativeResponse.Failure(
                "window-bounds-not-found",
                "无法读取当前 Edge 窗口范围，因此未开始切换。");
            return false;
        }

        var windowBounds = Rectangle.FromLTRB(nativeBounds.Left, nativeBounds.Top, nativeBounds.Right, nativeBounds.Bottom);
        if (windowBounds.Width <= 0 || windowBounds.Height <= 0)
        {
            failure = NativeResponse.Failure(
                "window-bounds-invalid",
                "当前 Edge 窗口不可见，因此未开始切换。");
            return false;
        }

        WindowSnapshotOverlay? candidate = null;
        try
        {
            var bitmap = new Bitmap(windowBounds.Width, windowBounds.Height);
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.CopyFromScreen(
                    windowBounds.Location,
                    Point.Empty,
                    windowBounds.Size,
                    CopyPixelOperation.SourceCopy);
            }

            candidate = new WindowSnapshotOverlay(
                bitmap,
                ToOverlayBounds(windowBounds, NativeMethods.GetDpiForWindow(edgeWindow)),
                edgeWindow);
            candidate.Show();
            overlay = candidate;
            failure = default!;
            return true;
        }
        catch (Exception)
        {
            candidate?.Dispose();
            failure = NativeResponse.Failure(
                "visual-isolation-failed",
                "无法建立当前窗口的无感切换覆盖层，因此未更改 Edge 外观。");
            return false;
        }
    }

    public void Dispose()
    {
        SnapshotForm? activeForm;
        lock (gate)
        {
            if (disposed)
            {
                return;
            }

            disposed = true;
            activeForm = form;
        }

        if (activeForm is not null && !activeForm.IsDisposed)
        {
            try
            {
                activeForm.BeginInvoke((MethodInvoker)activeForm.Close);
            }
            catch (InvalidOperationException)
            {
                // The visual-isolation window has already begun closing.
            }
        }

        if (closed.Wait(CloseTimeoutMilliseconds))
        {
            snapshot.Dispose();
        }
    }

    private void Show()
    {
        uiThread = new Thread(RunOverlayWindow)
        {
            IsBackground = true,
            Name = "Edge theme visual isolation",
        };
        uiThread.SetApartmentState(ApartmentState.STA);
        uiThread.Start();

        if (!shown.Wait(StartupTimeoutMilliseconds))
        {
            Dispose();
            throw new TimeoutException("The visual-isolation window did not appear in time.");
        }

        if (startupError is not null)
        {
            Dispose();
            throw new InvalidOperationException("The visual-isolation window could not be created.", startupError);
        }
    }

    private void RunOverlayWindow()
    {
        try
        {
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            var overlayForm = new SnapshotForm(snapshot, overlayBounds, targetEdgeWindow);
            overlayForm.Shown += (_, _) => shown.Set();
            lock (gate)
            {
                form = overlayForm;
                if (disposed)
                {
                    overlayForm.Dispose();
                    return;
                }
            }

            Application.Run(overlayForm);
        }
        catch (Exception error)
        {
            startupError = error;
            shown.Set();
        }
        finally
        {
            closed.Set();
        }
    }

    private static Rectangle ToOverlayBounds(Rectangle targetBounds, uint targetDpi)
    {
        // In this local WinForms host, top-level form placement is virtualized in
        // device-independent units even when its UI thread requests PerMonitorV2.
        // The screenshot and Edge bounds are physical pixels, so compensate with
        // the target Edge window's actual DPI before constructing the overlay.
        var scale = targetDpi == 0 ? 1d : targetDpi / 96d;
        return Rectangle.FromLTRB(
            ScaleForOverlay(targetBounds.Left, scale),
            ScaleForOverlay(targetBounds.Top, scale),
            ScaleForOverlay(targetBounds.Right, scale),
            ScaleForOverlay(targetBounds.Bottom, scale));
    }

    private static int ScaleForOverlay(int value, double scale) =>
        (int)Math.Round(value * scale, MidpointRounding.AwayFromZero);

    private sealed class SnapshotForm : Form
    {
        private const int WmMouseActivate = 0x0021;
        private const int MaNoActivateAndEat = 4;
        private const int GwlpHwndParent = -8;
        private const int WsExNoActivate = 0x08000000;
        private const int WsExToolWindow = 0x00000080;
        private const uint SwpNoActivate = 0x0010;
        private const uint SwpShowWindow = 0x0040;
        private const uint SwpNoOwnerZOrder = 0x0200;
        private static readonly IntPtr HwndTopmost = new(-1);

        private readonly Rectangle snapshotBounds;
        private readonly IntPtr targetEdgeWindow;
        private System.Windows.Forms.Timer? keepAboveTargetTimer;

        public SnapshotForm(Bitmap snapshot, Rectangle bounds, IntPtr targetEdgeWindow)
        {
            snapshotBounds = bounds;
            this.targetEdgeWindow = targetEdgeWindow;
            AutoScaleMode = AutoScaleMode.None;
            BackgroundImage = snapshot;
            BackgroundImageLayout = ImageLayout.Stretch;
            Bounds = bounds;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
        }

        protected override bool ShowWithoutActivation => true;

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);

            // Set an owner without making this a child window. A child uses the
            // Edge client area's coordinates and can be clipped while settings
            // repaints; an owned top-level popup keeps screen coordinates and is
            // still guaranteed to remain above its owner.
            NativeMethods.SetWindowLongPtr(Handle, GwlpHwndParent, targetEdgeWindow);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            KeepAboveTargetWindow();

            // Opening a tab makes Edge reassert its own z-order. A normal TopMost
            // form can therefore briefly fall behind the browser. Reassert the
            // top-most layer until the automation has safely restored the original
            // tab, so no internal navigation is visible to the user.
            keepAboveTargetTimer = new System.Windows.Forms.Timer { Interval = 25 };
            keepAboveTargetTimer.Tick += (_, _) => KeepAboveTargetWindow();
            keepAboveTargetTimer.Start();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            keepAboveTargetTimer?.Stop();
            keepAboveTargetTimer?.Dispose();
            keepAboveTargetTimer = null;
            base.OnFormClosed(e);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var parameters = base.CreateParams;
                parameters.ExStyle |= WsExNoActivate | WsExToolWindow;
                return parameters;
            }
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WmMouseActivate)
            {
                message.Result = (IntPtr)MaNoActivateAndEat;
                return;
            }

            base.WndProc(ref message);
        }

        private void KeepAboveTargetWindow()
        {
            if (IsDisposed || !IsHandleCreated || !NativeMethods.IsWindow(targetEdgeWindow))
            {
                return;
            }

            NativeMethods.SetWindowPos(
                Handle,
                HwndTopmost,
                snapshotBounds.X,
                snapshotBounds.Y,
                snapshotBounds.Width,
                snapshotBounds.Height,
                SwpNoActivate | SwpShowWindow | SwpNoOwnerZOrder);
        }
    }

    private static class NativeMethods
    {
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetWindowRect(IntPtr window, out NativeRect rectangle);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsWindow(IntPtr window);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetWindowPos(
            IntPtr window,
            IntPtr insertAfter,
            int x,
            int y,
            int width,
            int height,
            uint flags);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
        internal static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);

        [DllImport("user32.dll", SetLastError = true)]
        internal static extern uint GetDpiForWindow(IntPtr window);
    }

    private struct NativeRect
    {
        internal int Left;
        internal int Top;
        internal int Right;
        internal int Bottom;
    }
}
