[CmdletBinding()]
param([string]$OutputDir = $(if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { "backups" }))
$ErrorActionPreference = "Stop"
foreach ($name in @("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD")) {
  if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value) { throw "$name is required" }
}
if (-not (Get-Command mysqldump -ErrorAction SilentlyContinue)) { throw "mysqldump is required on PATH" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$base = Join-Path $OutputDir "$($env:DB_NAME)_$stamp"
$dump = "$base.sql"
$env:MYSQL_PWD = $env:DB_PASSWORD
& mysqldump --host=$env:DB_HOST --port=$(if ($env:DB_PORT) { $env:DB_PORT } else { "3306" }) --user=$env:DB_USER --single-transaction --quick --routines --events --triggers --hex-blob --set-gtid-purged=OFF --databases $env:DB_NAME | Out-File -FilePath $dump -Encoding utf8
if ($LASTEXITCODE -ne 0) { Remove-Item $dump -Force; throw "mysqldump failed" }
$hash = (Get-FileHash $dump -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $dump -Leaf)" | Set-Content "$dump.sha256" -NoNewline
@{ database=$env:DB_NAME; createdAtUtc=$stamp; dump=(Split-Path $dump -Leaf); sha256=$hash; schemaMigration=($(if ($env:SCHEMA_MIGRATION) {$env:SCHEMA_MIGRATION} else {"unknown"})) } | ConvertTo-Json -Compress | Set-Content "$base.json"
Write-Output "Created backup: $dump"
Write-Output "Keep local-only unless encrypted with age or an approved equivalent."
Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
