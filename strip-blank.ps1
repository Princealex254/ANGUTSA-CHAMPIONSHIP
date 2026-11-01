$p = "c:\Users\Alex\Desktop\Angutsa Tournament\standings.html"
$lines = Get-Content -LiteralPath $p
$kept = $lines | Where-Object { $_.Trim() -ne "" }
$kept | Set-Content -LiteralPath $p -Encoding UTF8
Write-Host ("kept " + $kept.Count + " of " + $lines.Count)
