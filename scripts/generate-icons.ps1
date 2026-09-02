[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconDirectory = Join-Path $projectRoot 'packages\controller\icons'
[System.IO.Directory]::CreateDirectory($iconDirectory) | Out-Null

function New-ActionIcon {
    param(
        [Parameter(Mandatory)]
        [ValidateSet(16, 32, 48, 128)]
        [int]$Size,

        [Parameter(Mandatory)]
        [ValidateSet('light', 'dark')]
        [string]$Mode,

        [Parameter(Mandatory)]
        [string]$OutputPath
    )

    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = $null
    $pen = $null
    $path = $null

    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([System.Drawing.Color]::Transparent)

        $stroke = [single][Math]::Max(1.15, $Size / 14)
        $lineColor = if ($Mode -eq 'light') {
            [System.Drawing.Color]::FromArgb(0, 0, 0)
        }
        else {
            [System.Drawing.Color]::FromArgb(245, 245, 245)
        }

        $pen = [System.Drawing.Pen]::new($lineColor, $stroke)
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

        $center = [single](($Size - 1) / 2)

        $radius = [single]($Size * 0.215)
        $diameter = [single](2 * $radius)
        $graphics.DrawEllipse($pen, [single]($center - $radius), [single]($center - $radius), $diameter, $diameter)

        $rayStart = [single]($radius + ($stroke * 1.6))
        $rayEnd = [single]($Size * 0.425)
        foreach ($angle in 0, 45, 90, 135, 180, 225, 270, 315) {
            $radians = [Math]::PI * $angle / 180
            $cosine = [Math]::Cos($radians)
            $sine = [Math]::Sin($radians)
            $graphics.DrawLine(
                $pen,
                [single]($center + ($cosine * $rayStart)),
                [single]($center + ($sine * $rayStart)),
                [single]($center + ($cosine * $rayEnd)),
                [single]($center + ($sine * $rayEnd))
            )
        }

        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        if ($null -ne $path) { $path.Dispose() }
        if ($null -ne $pen) { $pen.Dispose() }
        if ($null -ne $graphics) { $graphics.Dispose() }
        $bitmap.Dispose()
    }
}

foreach ($size in 16, 32, 48, 128) {
    foreach ($mode in 'light', 'dark') {
        $fileName = "icon-$mode-$size.png"
        New-ActionIcon -Size $size -Mode $mode -OutputPath (Join-Path $iconDirectory $fileName)
    }
}
