namespace EdgeBrowserThemeToggle.NativeHost;

public enum AppearanceMode
{
    Light,
    Dark,
}

public static class TogglePlan
{
    public static AppearanceMode Next(bool isDark) => isDark
        ? AppearanceMode.Light
        : AppearanceMode.Dark;
}
