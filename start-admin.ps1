$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env.local")) {
  Copy-Item "admin-api/.env.example" ".env.local"
  Write-Host "Created .env.local. Set SUPABASE_SECRET_KEY, then run this script again." -ForegroundColor Yellow
  exit 1
}

npm run build:standalone
node admin-api/src/server.mjs
