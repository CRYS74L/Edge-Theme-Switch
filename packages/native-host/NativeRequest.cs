using System.Text.Json;

namespace EdgeBrowserThemeToggle.NativeHost;

public sealed record NativeRequest(string Command, int ProtocolVersion)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static bool TryParse(string json, out NativeRequest request)
    {
        request = default!;

        try
        {
            var parsed = JsonSerializer.Deserialize<NativeRequest>(json, JsonOptions);
            if (parsed is null ||
                !string.Equals(parsed.Command, "toggle", StringComparison.Ordinal) ||
                parsed.ProtocolVersion != 1)
            {
                return false;
            }

            request = parsed;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
