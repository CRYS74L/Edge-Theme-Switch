using System.Globalization;

namespace EdgeBrowserThemeToggle.NativeHost;

public readonly record struct NativeHostInvocation(IntPtr ParentWindow)
{
    private const string ParentWindowPrefix = "--parent-window=";

    public static NativeHostInvocation Parse(IEnumerable<string> arguments)
    {
        foreach (var argument in arguments)
        {
            if (!argument.StartsWith(ParentWindowPrefix, StringComparison.Ordinal))
            {
                continue;
            }

            var valueText = argument[ParentWindowPrefix.Length..];
            if (!long.TryParse(valueText, NumberStyles.None, CultureInfo.InvariantCulture, out var value) ||
                value <= 0 ||
                (IntPtr.Size == sizeof(int) && value > int.MaxValue))
            {
                return new NativeHostInvocation(IntPtr.Zero);
            }

            return new NativeHostInvocation(new IntPtr(value));
        }

        return new NativeHostInvocation(IntPtr.Zero);
    }
}
