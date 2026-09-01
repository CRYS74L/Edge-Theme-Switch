using System.Text;
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

        Console.WriteLine("Native host contracts passed.");
        return 0;
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
