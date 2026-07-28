$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$url = "http://127.0.0.1:8787/"
$portInUse = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue

if (-not $portInUse) {
  if (-not (Test-Path ".env.local")) {
    Copy-Item "admin-api/.env.example" ".env.local"
    Start-Process "notepad.exe" (Join-Path $PSScriptRoot ".env.local")
    throw "Created .env.local. Set Supabase values, then run the shortcut again."
  }

  npm run build:standalone
  $escapedRoot = $PSScriptRoot.Replace("'", "''")
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-WindowStyle", "Minimized",
      "-Command", "Set-Location -LiteralPath '$escapedRoot'; node admin-api/src/server.mjs"
    ) `
    -WindowStyle Minimized

  $ready = $false
  foreach ($attempt in 1..30) {
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        $ready = $true
        break
      }
    } catch {
      # Server is still starting.
    }
  }

  if (-not $ready) {
    throw "Local Admin API did not start. Check Node or run .\start-admin.ps1"
  }
}

Start-Process $url
