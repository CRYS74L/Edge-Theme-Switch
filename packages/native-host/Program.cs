using System.Text;

namespace EdgeBrowserThemeToggle.NativeHost;

internal static class Program
{
    private const int LoopbackBridgePort = 42761;
    private const string BridgeToken = "REDACTED_LOCAL_BRIDGE_TOKEN";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && string.Equals(args[0], "--bridge-server", StringComparison.Ordinal))
        {
            using var bridge = new LoopbackBridgeServer(
                LoopbackBridgePort,
                BridgeToken,
                () => new EdgeAppearanceAutomator().Toggle());
            bridge.Start();
            bridge.WaitForShutdown();
            return 0;
        }

        using var input = Console.OpenStandardInput();
        using var output = Console.OpenStandardOutput();

        try
        {
            var payload = NativeMessageCodec.ReadPayload(input);
            if (payload is null)
            {
                return 0;
            }

            var requestJson = Encoding.UTF8.GetString(payload);
            if (!NativeRequest.TryParse(requestJson, out _))
            {
                NativeMessageCodec.WriteResponse(output, NativeResponse.Failure(
                    "invalid-request",
                    "本机桥接只接受 toggle 协议版本 1 请求。"));
                return 0;
            }

            var response = new EdgeAppearanceAutomator().Toggle();
            NativeMessageCodec.WriteResponse(output, response);
            return 0;
        }
        catch (Exception error)
        {
            try
            {
                NativeMessageCodec.WriteResponse(output, NativeResponse.Failure(
                    "host-unhandled-error",
                    "本机桥接发生未预期错误，未更改 Edge 外观。"));
            }
            catch
            {
                // Native Messaging may already have closed stdout; never send diagnostics to stdout.
            }

            Console.Error.WriteLine(error);
            return 1;
        }
    }
}
