$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$brandDirectory = Join-Path $PSScriptRoot '../src/assets/brand'
foreach ($theme in @('light', 'dark')) {
  $source = [Drawing.Bitmap]::new((Join-Path $brandDirectory "logo-$theme.png"))
  try {
    # Transparent margins in the artwork must not consume the browser's tiny
    # fixed icon slot. Keep the original files untouched and fit visible pixels.
    $minX = $source.Width; $minY = $source.Height; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $source.Height; $y++) {
      for ($x = 0; $x -lt $source.Width; $x++) {
        if ($source.GetPixel($x, $y).A -gt 8) {
          $minX = [Math]::Min($minX, $x); $minY = [Math]::Min($minY, $y)
          $maxX = [Math]::Max($maxX, $x); $maxY = [Math]::Max($maxY, $y)
        }
      }
    }
    if ($maxX -lt $minX) { throw "The $theme logo has no visible pixels." }
    $crop = [Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
    foreach ($size in @(16, 32, 48, 128)) {
      $target = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [Drawing.Graphics]::FromImage($target)
      try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $padding = [Math]::Max(1, [Math]::Round($size * 0.03))
        $scale = ($size - 2 * $padding) / [Math]::Max($crop.Width, $crop.Height)
        $width = [int][Math]::Round($crop.Width * $scale); $height = [int][Math]::Round($crop.Height * $scale)
        $destination = [Drawing.Rectangle]::new([int](($size - $width) / 2), [int](($size - $height) / 2), $width, $height)
        $graphics.DrawImage($source, $destination, $crop, [Drawing.GraphicsUnit]::Pixel)
        $name = if ($theme -eq 'dark') { "icon-dark-$size.png" } else { "icon-$size.png" }
        $target.Save((Join-Path $brandDirectory $name), [Drawing.Imaging.ImageFormat]::Png)
      } finally { $graphics.Dispose(); $target.Dispose() }
    }
  } finally { $source.Dispose() }
}
Write-Output 'Generated light and dark PNG icons from the original transparent logos.'
