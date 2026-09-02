using System.Buffers.Binary;
using System.IO;
using System.Text.Json;

namespace EdgeBrowserThemeToggle.NativeHost;

public static class NativeMessageCodec
{
    private const int MaximumPayloadBytes = 1024 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static byte[] Frame(ReadOnlySpan<byte> payload)
    {
        if (payload.Length > MaximumPayloadBytes)
        {
            throw new InvalidDataException($"Native message exceeds {MaximumPayloadBytes} bytes.");
        }

        var frame = new byte[payload.Length + sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(frame.AsSpan(0, sizeof(int)), payload.Length);
        payload.CopyTo(frame.AsSpan(sizeof(int)));
        return frame;
    }

    public static byte[]? ReadPayload(Stream input)
    {
        var lengthBuffer = new byte[sizeof(int)];
        if (!ReadExactly(input, lengthBuffer, allowEmptyInput: true))
        {
            return null;
        }

        var length = BinaryPrimitives.ReadInt32LittleEndian(lengthBuffer);
        if (length < 0 || length > MaximumPayloadBytes)
        {
            throw new InvalidDataException($"Native message length {length} is not supported.");
        }

        var payload = new byte[length];
        ReadExactly(input, payload, allowEmptyInput: false);
        return payload;
    }

    public static void WriteResponse(Stream output, NativeResponse response)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(response, JsonOptions);
        var frame = Frame(payload);
        output.Write(frame, 0, frame.Length);
        output.Flush();
    }

    private static bool ReadExactly(Stream input, byte[] buffer, bool allowEmptyInput)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = input.Read(buffer, offset, buffer.Length - offset);
            if (read == 0)
            {
                if (offset == 0 && allowEmptyInput)
                {
                    return false;
                }

                throw new EndOfStreamException("Native message ended before its frame was complete.");
            }

            offset += read;
        }

        return true;
    }
}
