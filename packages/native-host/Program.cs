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
            request => request.Command switch
            {
                "toggle" => new EdgeAppearanceAutomator().Toggle(invocation.ParentWindow),
                _ => NativeResponse.Failure(
                    "unsupported-command",
                    "本机组件只接受 toggle 协议请求。"),
            });
    }
}
