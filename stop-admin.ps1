$connection = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if (-not $connection) {
  Write-Host "Neko Control Room is not running." -ForegroundColor Yellow
  exit 0
}

$processIds = @($connection | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($processId in $processIds) {
  Stop-Process -Id $processId -Force
}

Write-Host "Neko Control Room stopped." -ForegroundColor Green
