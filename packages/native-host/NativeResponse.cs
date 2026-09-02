namespace EdgeBrowserThemeToggle.NativeHost;

public sealed record NativeResponse(
    bool Ok,
    string? Mode = null,
    string? ErrorCode = null,
    string? Message = null)
{
    public static NativeResponse Success(AppearanceMode mode) => new(
        Ok: true,
        Mode: mode == AppearanceMode.Dark ? "dark" : "light");

    public static NativeResponse Failure(string errorCode, string message) => new(
        Ok: false,
        ErrorCode: errorCode,
        Message: message);
}
