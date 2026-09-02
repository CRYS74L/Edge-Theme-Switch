namespace EdgeBrowserThemeToggle.NativeHost;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var invocation = NativeHostInvocation.Parse(args);
        using var input = Console.OpenStandardInput();
        using var output = Console.OpenStandardOutput();
        return NativeHostApplication.Run(
            input,
            output,
            _ => new EdgeAppearanceAutomator().Toggle(invocation.ParentWindow));
    }
}
