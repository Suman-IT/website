[CmdletBinding()]
param([string]$ComposeFile = "compose.recovery.yaml")
$ErrorActionPreference = "Stop"
$dump = Join-Path ([System.IO.Path]::GetTempPath()) "skdora-recovery-$([guid]::NewGuid()).sql"
try {
  docker compose -f $ComposeFile up -d --wait
  if ($LASTEXITCODE -ne 0) { throw "Could not start isolated recovery services" }
  docker compose -f $ComposeFile exec -T source-db mysqldump -urecovery -precovery-source --single-transaction --quick --routines --events --triggers recovery_source | Out-File -FilePath $dump -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Source dump failed" }
  $hash = (Get-FileHash $dump -Algorithm SHA256).Hash
  Get-Content $dump -Raw | docker compose -f $ComposeFile exec -T restore-db mysql -uroot -precovery-restore-root recovery_source
  if ($LASTEXITCODE -ne 0) { throw "Restore failed" }
  $count = docker compose -f $ComposeFile exec -T restore-db mysql -uroot -precovery-restore-root -N -B recovery_source -e "SELECT COUNT(*) FROM recovery_sentinel WHERE marker='isolated-recovery-drill';"
  if (($count -replace "\s", "") -ne "1") { throw "Recovery sentinel was not restored" }
  Write-Output "Recovery drill passed. SHA256: $hash"
} finally {
  docker compose -f $ComposeFile down -v --remove-orphans | Out-Null
  Remove-Item $dump -Force -ErrorAction SilentlyContinue
}
