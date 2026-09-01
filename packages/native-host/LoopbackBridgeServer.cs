using System.Net;
using System.Net.Sockets;
using System.IO;
using System.Threading;

namespace EdgeBrowserThemeToggle.NativeHost;

public sealed class LoopbackBridgeServer : IDisposable
{
    private readonly TcpListener listener;
    private readonly string bridgeToken;
    private readonly Func<NativeResponse> toggle;
    private readonly CancellationTokenSource cancellation = new();
    private readonly ManualResetEventSlim stopped = new(initialState: false);
    private string lastToggleAttempt = "No toggle request has been received.";
    private Thread? worker;

    public LoopbackBridgeServer(int port, string bridgeToken, Func<NativeResponse> toggle)
    {
        listener = new TcpListener(IPAddress.Loopback, port);
        this.bridgeToken = bridgeToken;
        this.toggle = toggle;
    }

    public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;

    public void Start()
    {
        if (worker is not null)
        {
            throw new InvalidOperationException("Loopback bridge server is already running.");
        }

        listener.Start();
        worker = new Thread(Serve)
        {
            IsBackground = true,
            Name = "Edge appearance loopback bridge",
        };
        worker.SetApartmentState(ApartmentState.STA);
        worker.Start();
    }

    public void WaitForShutdown() => stopped.Wait();

    public void Dispose()
    {
        RequestStop();
        worker?.Join(TimeSpan.FromSeconds(2));
        cancellation.Dispose();
        stopped.Dispose();
    }

    private void Serve()
    {
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                try
                {
                    using var client = listener.AcceptTcpClient();
                    using var stream = client.GetStream();
                    HandleRequest(stream);
                }
                catch (SocketException) when (cancellation.IsCancellationRequested)
                {
                    return;
                }
                catch (ObjectDisposedException) when (cancellation.IsCancellationRequested)
                {
                    return;
                }
            }
        }
        finally
        {
            stopped.Set();
        }
    }

    private void RequestStop()
    {
        cancellation.Cancel();
        listener.Stop();
    }

    private void HandleRequest(Stream stream)
    {
        var receivedToggleRequest = false;
        try
        {
            var request = LoopbackBridgeProtocol.ReadRequest(stream);
            if (string.Equals(request.Method, "GET", StringComparison.Ordinal) &&
                string.Equals(request.Path, "/health", StringComparison.Ordinal))
            {
                LoopbackBridgeProtocol.WriteJsonResponse(
                    stream,
                    200,
                    new NativeResponse(true, "ready", Message: Volatile.Read(ref lastToggleAttempt)));
                return;
            }

            if (string.Equals(request.Method, "POST", StringComparison.Ordinal) &&
                string.Equals(request.Path, "/shutdown", StringComparison.Ordinal))
            {
                LoopbackBridgeProtocol.WriteJsonResponse(stream, 200, new NativeResponse(true, "stopping"));
                RequestStop();
                return;
            }

            var isToggleRequest = string.Equals(request.Method, "POST", StringComparison.Ordinal) &&
                                  string.Equals(request.Path, "/toggle", StringComparison.Ordinal);
            receivedToggleRequest = isToggleRequest;
            var tokenAccepted = string.Equals(request.BridgeToken, bridgeToken, StringComparison.Ordinal);
            if (isToggleRequest)
            {
                Volatile.Write(
                    ref lastToggleAttempt,
                    $"POST /toggle; bridge-token={(tokenAccepted ? "accepted" : "rejected")}");
            }

            if (isToggleRequest && !tokenAccepted)
            {
                LoopbackBridgeProtocol.WriteJsonResponse(
                    stream,
                    403,
                    NativeResponse.Failure("token-forbidden", "本地桥接拒绝了未授权请求。"));
                return;
            }

            if (!string.Equals(request.Method, "POST", StringComparison.Ordinal) ||
                !string.Equals(request.Path, "/toggle", StringComparison.Ordinal) ||
                !NativeRequest.TryParse(request.Body, out _))
            {
                LoopbackBridgeProtocol.WriteJsonResponse(
                    stream,
                    400,
                    NativeResponse.Failure("invalid-request", "本地桥接只接受 toggle 协议版本 1 请求。"));
                return;
            }

            var result = toggle();
            Volatile.Write(
                ref lastToggleAttempt,
                $"POST /toggle; bridge-token=accepted; result={DescribeResult(result)}");
            LoopbackBridgeProtocol.WriteJsonResponse(stream, 200, result, allowCors: true);
        }
        catch (InvalidDataException)
        {
            LoopbackBridgeProtocol.WriteJsonResponse(
                stream,
                400,
                NativeResponse.Failure("invalid-request", "本地桥接请求格式无效。"));
        }
        catch (EndOfStreamException)
        {
            // A disconnected client cannot receive a response.
        }
        catch (Exception)
        {
            if (receivedToggleRequest)
            {
                Volatile.Write(ref lastToggleAttempt, "POST /toggle; bridge-token=accepted; result=exception");
            }

            try
            {
                LoopbackBridgeProtocol.WriteJsonResponse(
                    stream,
                    500,
                    NativeResponse.Failure("bridge-unhandled-error", "本地桥接发生未预期错误，未更改外观。"));
            }
            catch
            {
                // The client may have closed the connection while the handler failed.
            }
        }
    }

    private static string DescribeResult(NativeResponse result) => result.Ok
        ? $"ok:{result.Mode ?? "unknown"}"
        : $"failure:{result.ErrorCode ?? "unknown"}";
}
