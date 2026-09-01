using System.Text;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using EdgeBrowserThemeToggle.NativeHost;

var requestBytes = Encoding.UTF8.GetBytes(
    "POST /toggle HTTP/1.1\r\n" +
    "Host: 127.0.0.1:42761\r\n" +
    "Origin: chrome-extension://cfcjmbhncpefmmhmpakmkigljppponpm\r\n" +
    "X-Edge-Browser-Theme-Toggle: REDACTED_LOCAL_BRIDGE_TOKEN\r\n" +
    "Content-Length: 40\r\n" +
    "Content-Type: application/json\r\n\r\n" +
    "{\"command\":\"toggle\",\"protocolVersion\":1}");

using var requestStream = new MemoryStream(requestBytes);
var request = LoopbackBridgeProtocol.ReadRequest(requestStream);
ContractAssert.Equal("POST", request.Method, "桥接只应接收 POST 请求");
ContractAssert.Equal("/toggle", request.Path, "桥接请求必须指向 toggle 路径");
ContractAssert.True(string.Equals("chrome-extension://cfcjmbhncpefmmhmpakmkigljppponpm", request.Origin, StringComparison.Ordinal), "桥接必须保留扩展来源以便授权校验");
ContractAssert.True(string.Equals("REDACTED_LOCAL_BRIDGE_TOKEN", request.BridgeToken, StringComparison.Ordinal), "桥接必须保留扩展专用请求头以便授权校验");
ContractAssert.Equal("{\"command\":\"toggle\",\"protocolVersion\":1}", request.Body, "桥接必须保留完整 JSON 请求体");

using var responseStream = new MemoryStream();
LoopbackBridgeProtocol.WriteJsonResponse(responseStream, 200, NativeResponse.Success(AppearanceMode.Dark));
var responseText = Encoding.UTF8.GetString(responseStream.ToArray());
ContractAssert.True(responseText.StartsWith("HTTP/1.1 200 OK\r\n", StringComparison.Ordinal), "桥接成功响应必须使用 HTTP 200");
ContractAssert.True(responseText.Contains("{\"ok\":true,\"mode\":\"dark\"}", StringComparison.Ordinal), "桥接必须返回已确认的深色结果");

var toggleCount = 0;
using var server = new LoopbackBridgeServer(0, "REDACTED_LOCAL_BRIDGE_TOKEN", () =>
{
    toggleCount++;
    return NativeResponse.Success(AppearanceMode.Light);
});
server.Start();

using var client = new TcpClient();
client.Connect(IPAddress.Loopback, server.Port);
using var network = client.GetStream();
var toggleBytes = Encoding.UTF8.GetBytes(
    "POST /toggle HTTP/1.1\r\n" +
    $"Host: 127.0.0.1:{server.Port}\r\n" +
    "Origin: chrome-extension://cfcjmbhncpefmmhmpakmkigljppponpm\r\n" +
    "X-Edge-Browser-Theme-Toggle: REDACTED_LOCAL_BRIDGE_TOKEN\r\n" +
    "Content-Length: 40\r\n\r\n" +
    "{\"command\":\"toggle\",\"protocolVersion\":1}");
network.Write(toggleBytes, 0, toggleBytes.Length);
var networkResponse = new StreamReader(network, Encoding.UTF8).ReadToEnd();
ContractAssert.Equal(1, toggleCount, "有效 toggle 请求必须只调用一次外观切换");
ContractAssert.True(networkResponse.StartsWith("HTTP/1.1 200 OK\r\n", StringComparison.Ordinal), "运行中的回环桥接必须回传 HTTP 200");
ContractAssert.True(networkResponse.Contains("Access-Control-Allow-Origin: *\r\n", StringComparison.Ordinal), "已授权的扩展请求必须能读取桥接响应");
ContractAssert.True(networkResponse.Contains("{\"ok\":true,\"mode\":\"light\"}", StringComparison.Ordinal), "运行中的回环桥接必须返回切换确认结果");

using var healthClient = new TcpClient();
healthClient.Connect(IPAddress.Loopback, server.Port);
using var healthNetwork = healthClient.GetStream();
var healthBytes = Encoding.ASCII.GetBytes($"GET /health HTTP/1.1\r\nHost: 127.0.0.1:{server.Port}\r\n\r\n");
healthNetwork.Write(healthBytes, 0, healthBytes.Length);
var healthResponse = new StreamReader(healthNetwork, Encoding.UTF8).ReadToEnd();
ContractAssert.Equal(1, toggleCount, "健康检查不得触发外观切换");
ContractAssert.True(healthResponse.StartsWith("HTTP/1.1 200 OK\r\n", StringComparison.Ordinal), "健康检查必须回传 HTTP 200");
ContractAssert.True(healthResponse.Contains("\"mode\":\"ready\"", StringComparison.Ordinal), "健康检查必须确认回环桥接已就绪");
ContractAssert.True(healthResponse.Contains("\"message\":\"POST /toggle; bridge-token=accepted; result=ok:light\"", StringComparison.Ordinal), "健康检查必须保留最近一次切换请求的授权和结果");

using var rejectedClient = new TcpClient();
rejectedClient.Connect(IPAddress.Loopback, server.Port);
using var rejectedNetwork = rejectedClient.GetStream();
var rejectedBytes = Encoding.UTF8.GetBytes(
    "POST /toggle HTTP/1.1\r\n" +
    $"Host: 127.0.0.1:{server.Port}\r\n" +
    "Origin: chrome-extension://cfcjmbhncpefmmhmpakmkigljppponpm\r\n" +
    "Content-Length: 40\r\n\r\n" +
    "{\"command\":\"toggle\",\"protocolVersion\":1}");
rejectedNetwork.Write(rejectedBytes, 0, rejectedBytes.Length);
var rejectedResponse = new StreamReader(rejectedNetwork, Encoding.UTF8).ReadToEnd();
ContractAssert.Equal(1, toggleCount, "缺少扩展请求头的请求不得触发外观切换");
ContractAssert.True(rejectedResponse.StartsWith("HTTP/1.1 403 Forbidden\r\n", StringComparison.Ordinal), "缺少扩展请求头的请求必须被拒绝");

using var shutdownClient = new TcpClient();
shutdownClient.Connect(IPAddress.Loopback, server.Port);
using var shutdownNetwork = shutdownClient.GetStream();
var shutdownBytes = Encoding.ASCII.GetBytes($"POST /shutdown HTTP/1.1\r\nHost: 127.0.0.1:{server.Port}\r\nContent-Length: 0\r\n\r\n");
shutdownNetwork.Write(shutdownBytes, 0, shutdownBytes.Length);
var shutdownResponse = new StreamReader(shutdownNetwork, Encoding.UTF8).ReadToEnd();
ContractAssert.True(shutdownResponse.StartsWith("HTTP/1.1 200 OK\r\n", StringComparison.Ordinal), "停止请求必须得到 HTTP 200 确认");

using var bridgeProcess = Process.Start(new ProcessStartInfo
{
    FileName = "dotnet",
    Arguments = $"\"{typeof(TogglePlan).Assembly.Location}\" --bridge-server",
    UseShellExecute = false,
    CreateNoWindow = true,
}) ?? throw new InvalidOperationException("无法启动本地桥接进程测试实例。");
try
{
    string? processHealthResponse = null;
    var startupDeadline = DateTime.UtcNow.AddSeconds(4);
    while (DateTime.UtcNow < startupDeadline && !bridgeProcess.HasExited)
    {
        try
        {
            using var processHealthClient = new TcpClient();
            processHealthClient.Connect(IPAddress.Loopback, 42761);
            using var processHealthNetwork = processHealthClient.GetStream();
            var processHealthBytes = Encoding.ASCII.GetBytes("GET /health HTTP/1.1\r\nHost: 127.0.0.1:42761\r\n\r\n");
            processHealthNetwork.Write(processHealthBytes, 0, processHealthBytes.Length);
            processHealthResponse = new StreamReader(processHealthNetwork, Encoding.UTF8).ReadToEnd();
            break;
        }
        catch (SocketException)
        {
            Thread.Sleep(50);
        }
    }

    ContractAssert.True(processHealthResponse?.Contains("\"mode\":\"ready\"", StringComparison.Ordinal) == true,
        "带 --bridge-server 启动的助手必须在固定回环端口公布健康状态");
}
finally
{
    if (!bridgeProcess.HasExited)
    {
        bridgeProcess.Kill(entireProcessTree: true);
        bridgeProcess.WaitForExit();
    }
}

Console.WriteLine("Loopback bridge contracts passed.");

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
