using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace EdgeBrowserThemeToggle.NativeHost;

public sealed record LoopbackBridgeRequest(string Method, string Path, string? Origin, string? BridgeToken, string Body);

public static class LoopbackBridgeProtocol
{
    private const int MaximumHeaderBytes = 16 * 1024;
    private const int MaximumBodyBytes = 4 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static LoopbackBridgeRequest ReadRequest(Stream input)
    {
        var headerText = ReadHeader(input);
        var headerLines = headerText.Split("\r\n", StringSplitOptions.None);
        if (headerLines.Length == 0)
        {
            throw new InvalidDataException("Loopback bridge request is missing a request line.");
        }

        var requestLine = headerLines[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (requestLine.Length != 3 || !requestLine[2].StartsWith("HTTP/", StringComparison.Ordinal))
        {
            throw new InvalidDataException("Loopback bridge request line is invalid.");
        }

        var contentLength = 0;
        string? origin = null;
        string? bridgeToken = null;
        foreach (var headerLine in headerLines.Skip(1))
        {
            var separator = headerLine.IndexOf(':');
            if (separator <= 0)
            {
                throw new InvalidDataException("Loopback bridge request header is invalid.");
            }

            var name = headerLine[..separator].Trim();
            var value = headerLine[(separator + 1)..].Trim();
            if (name.Equals("Origin", StringComparison.OrdinalIgnoreCase))
            {
                origin = value;
                continue;
            }

            if (name.Equals("X-Edge-Browser-Theme-Toggle", StringComparison.OrdinalIgnoreCase))
            {
                bridgeToken = value;
                continue;
            }

            if (!name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out contentLength) ||
                contentLength < 0 ||
                contentLength > MaximumBodyBytes)
            {
                throw new InvalidDataException("Loopback bridge content length is invalid.");
            }
        }

        var bodyBytes = new byte[contentLength];
        ReadExactly(input, bodyBytes);
        return new LoopbackBridgeRequest(
            requestLine[0],
            requestLine[1],
            origin,
            bridgeToken,
            Encoding.UTF8.GetString(bodyBytes));
    }

    public static void WriteJsonResponse(Stream output, int statusCode, NativeResponse response, bool allowCors = false)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(response, JsonOptions);
        var reason = statusCode switch
        {
            200 => "OK",
            400 => "Bad Request",
            403 => "Forbidden",
            404 => "Not Found",
            409 => "Conflict",
            500 => "Internal Server Error",
            503 => "Service Unavailable",
            _ => "Error",
        };
        var header = $"HTTP/1.1 {statusCode} {reason}\r\n" +
                     "Content-Type: application/json; charset=utf-8\r\n" +
                     (allowCors ? "Access-Control-Allow-Origin: *\r\n" : string.Empty) +
                     $"Content-Length: {payload.Length}\r\n" +
                     "Connection: close\r\n\r\n";
        var headerBytes = Encoding.ASCII.GetBytes(header);
        output.Write(headerBytes, 0, headerBytes.Length);
        output.Write(payload, 0, payload.Length);
        output.Flush();
    }

    private static string ReadHeader(Stream input)
    {
        var buffer = new List<byte>();
        while (buffer.Count < MaximumHeaderBytes)
        {
            var next = input.ReadByte();
            if (next < 0)
            {
                throw new EndOfStreamException("Loopback bridge request ended before its header.");
            }

            buffer.Add((byte)next);
            var count = buffer.Count;
            if (count >= 4 &&
                buffer[count - 4] == '\r' &&
                buffer[count - 3] == '\n' &&
                buffer[count - 2] == '\r' &&
                buffer[count - 1] == '\n')
            {
                return Encoding.ASCII.GetString(buffer.Take(count - 4).ToArray());
            }
        }

        throw new InvalidDataException("Loopback bridge request header is too large.");
    }

    private static void ReadExactly(Stream input, byte[] buffer)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = input.Read(buffer, offset, buffer.Length - offset);
            if (read == 0)
            {
                throw new EndOfStreamException("Loopback bridge request ended before its body.");
            }

            offset += read;
        }
    }
}
