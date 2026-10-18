[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$themeDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'packages\theme-dark'
$manifest = Get-Content -LiteralPath (Join-Path $themeDirectory 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# Edge 139 derives its vertical tab surfaces from the toolbar image.
# Keep frame and toolbar images separate so the title bar can remain darker.
foreach ($surface in @(
    @{ File = 'frame-dark.png'; Role = 'frame' },
    @{ File = 'toolbar-gray.png'; Role = 'toolbar' }
)) {
    $rgb = $manifest.theme.colors.($surface.Role)
    $bitmap = [System.Drawing.Bitmap]::new(16, 128, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = $null
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear([System.Drawing.Color]::FromArgb(255, $rgb[0], $rgb[1], $rgb[2]))
        $bitmap.Save((Join-Path $themeDirectory $surface.File), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        if ($null -ne $graphics) { $graphics.Dispose() }
        $bitmap.Dispose()
    }
}
