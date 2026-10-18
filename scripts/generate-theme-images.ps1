[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$themeDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'packages\theme-dark'
$manifest = Get-Content -LiteralPath (Join-Path $themeDirectory 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# Edge 139 derives its vertical tab surfaces from the toolbar image.
# Vertical tabs also reuse the toolbar image for the title bar. The separate
# opaque frame overlay restores its darker colour after that image is painted.
foreach ($surface in @(
    @{ File = 'frame-dark.png'; Role = 'frame'; Width = 16; Height = 128 },
    @{ File = 'toolbar-gray.png'; Role = 'toolbar'; Width = 16; Height = 128 },
    @{ File = 'titlebar-dark.png'; Role = 'frame'; Width = 8192; Height = 64 }
)) {
    $rgb = $manifest.theme.colors.($surface.Role)
    $bitmap = [System.Drawing.Bitmap]::new($surface.Width, $surface.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
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
