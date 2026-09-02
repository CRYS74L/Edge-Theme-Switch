using System.Text;
using System.Text.Json;
using EdgeBrowserThemeToggle.NativeHost;

static class Program
{
    private static int Main()
    {
        ContractAssert.Equal(AppearanceMode.Dark, TogglePlan.Next(isDark: false), "系统或浅色外观的下一次动作必须选深色");
        ContractAssert.Equal(AppearanceMode.Light, TogglePlan.Next(isDark: true), "深色外观的下一次动作必须选浅色");

        const string json = "{\"command\":\"toggle\",\"protocolVersion\":1}";
        var frame = NativeMessageCodec.Frame(Encoding.UTF8.GetBytes(json));
        ContractAssert.Equal(4 + Encoding.UTF8.GetByteCount(json), frame.Length, "Native Messaging 帧长度必须包含四字节长度前缀");
        ContractAssert.Equal(Encoding.UTF8.GetByteCount(json), BitConverter.ToInt32(frame, 0), "Native Messaging 前缀必须为 little-endian 消息长度");
        ContractAssert.Equal(json, Encoding.UTF8.GetString(frame.AsSpan(4)), "Native Messaging 负载必须原样保留 JSON");

        ContractAssert.True(NativeRequest.TryParse(json, out var request), "toggle 请求必须可解析");
        ContractAssert.Equal("toggle", request.Command, "解析后的命令必须为 toggle");
        ContractAssert.True(!NativeRequest.TryParse("{\"command\":\"delete\"}", out _), "未知命令必须被拒绝");

        var toggleCalls = 0;
        using var input = new MemoryStream(NativeMessageCodec.Frame(Encoding.UTF8.GetBytes(json)));
        using var output = new MemoryStream();
        var exitCode = NativeHostApplication.Run(input, output, _ =>
        {
            toggleCalls++;
            return NativeResponse.Success(AppearanceMode.Dark);
        });

        ContractAssert.Equal(0, exitCode, "有效 Native Messaging 请求必须以成功退出");
        ContractAssert.Equal(1, toggleCalls, "一次 sendNativeMessage 请求必须只调用一次外观切换");
        var successResponse = ReadResponse(output);
        ContractAssert.True(successResponse.GetProperty("ok").GetBoolean(), "成功响应必须明确确认结果");
        ContractAssert.Equal("dark", successResponse.GetProperty("mode").GetString()!, "成功响应必须返回实际选中的深色模式");

        using var invalidInput = new MemoryStream(NativeMessageCodec.Frame(Encoding.UTF8.GetBytes("{\"command\":\"delete\",\"protocolVersion\":1}")));
        using var invalidOutput = new MemoryStream();
        var invalidExitCode = NativeHostApplication.Run(invalidInput, invalidOutput, _ =>
        {
            throw new InvalidOperationException("无效请求不得调用实际切换。");
        });

        ContractAssert.Equal(0, invalidExitCode, "协议错误必须以可读取的 Native Messaging 响应结束");
        var invalidResponse = ReadResponse(invalidOutput);
        ContractAssert.True(!invalidResponse.GetProperty("ok").GetBoolean(), "无效请求不得伪装为成功");
        ContractAssert.Equal("invalid-request", invalidResponse.GetProperty("errorCode").GetString()!, "无效请求必须具有稳定错误码");

        var invocation = NativeHostInvocation.Parse(new[] { "--parent-window=2748" });
        ContractAssert.Equal(new IntPtr(2748), invocation.ParentWindow, "Edge 传入的 parent-window 必须优先用于锁定发起单击的窗口");
        ContractAssert.Equal(IntPtr.Zero, NativeHostInvocation.Parse(new[] { "--parent-window=not-a-handle" }).ParentWindow,
            "格式错误的 parent-window 不得被当成任意窗口句柄使用");

        Console.WriteLine("Native host contracts passed.");
        return 0;
    }

    private static JsonElement ReadResponse(MemoryStream output)
    {
        output.Position = 0;
        var payload = NativeMessageCodec.ReadPayload(output)
            ?? throw new InvalidOperationException("本机组件未写入 Native Messaging 响应。");
        using var document = JsonDocument.Parse(payload);
        return document.RootElement.Clone();
    }
}

static class ContractAssert
{
    public static void Equal<T>(T expected, T actual, string message)
        where T : notnull
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException($"{message}. Expected {expected}, got {actual}.");
        }
    }

    public static void True(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }
}
