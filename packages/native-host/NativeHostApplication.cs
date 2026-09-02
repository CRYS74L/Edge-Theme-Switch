using System.IO;
using System.Text;

namespace EdgeBrowserThemeToggle.NativeHost;

public static class NativeHostApplication
{
    public static int Run(
        Stream input,
        Stream output,
        Func<NativeRequest, NativeResponse> handleRequest)
    {
        try
        {
            var payload = NativeMessageCodec.ReadPayload(input);
            if (payload is null)
            {
                return 0;
            }

            var requestJson = Encoding.UTF8.GetString(payload);
            if (!NativeRequest.TryParse(requestJson, out var request))
            {
                NativeMessageCodec.WriteResponse(output, NativeResponse.Failure(
                    "invalid-request",
                    "本机组件只接受 toggle 协议版本 1 请求。"));
                return 0;
            }

            NativeMessageCodec.WriteResponse(output, handleRequest(request));
            return 0;
        }
        catch (Exception)
        {
            TryWriteFailure(output);
            return 1;
        }
    }

    private static void TryWriteFailure(Stream output)
    {
        try
        {
            NativeMessageCodec.WriteResponse(output, NativeResponse.Failure(
                "host-unhandled-error",
                "本机组件发生未预期错误，未报告外观切换成功。"));
        }
        catch
        {
            // The browser may have closed the stdio pipe before a failure response can be sent.
        }
    }
}
