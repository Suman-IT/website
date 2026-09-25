[CmdletBinding()]
$ErrorActionPreference = "Stop"
$dump = Join-Path ([System.IO.Path]::GetTempPath()) "skdora-portability-$([guid]::NewGuid()).sql"
try {
  docker compose -f compose.portability.yaml up -d --wait source-db target-db
  if ($LASTEXITCODE -ne 0) { throw "Could not start source and target environments" }
  docker compose -f compose.portability.yaml run --rm source-migrate
  if ($LASTEXITCODE -ne 0) { throw "Source migration and fixture load failed" }
  docker compose -f compose.portability.yaml exec -T source-db mysqldump -uroot -psource-root --single-transaction --quick --routines --events --triggers skdora_source | Out-File -FilePath $dump -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Source export failed" }
  $hash = (Get-FileHash $dump -Algorithm SHA256).Hash.ToLowerInvariant()
  Get-Content $dump -Raw | docker compose -f compose.portability.yaml exec -T target-db mysql -uroot -ptarget-root skdora_target
  if ($LASTEXITCODE -ne 0) { throw "Target import failed" }
  $appointment = docker compose -f compose.portability.yaml exec -T target-db mysql -uroot -ptarget-root -N -B skdora_target -e "SELECT public_reference FROM appointments WHERE id=1;" | Out-String
  if (($appointment -replace "\s", "") -ne "RECOVERY-SENTINEL-00000001") { throw "Migrated appointment sentinel was not found" }
  docker compose -f compose.portability.yaml up -d --build --wait target-app
  if ($LASTEXITCODE -ne 0) { throw "Target application failed to start" }
  $health = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:13100/health
  if ($health.StatusCode -ne 200) { throw "Target health check failed" }
  $hospital = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:13100/api/public/hospital
  if ($hospital.Content -notmatch "Recovery Rehearsal Hospital") { throw "Target public hospital check failed" }
  Write-Output "Portability rehearsal passed. Target application served migrated data. SHA256: $hash"
} finally {
  docker compose -f compose.portability.yaml down -v --remove-orphans | Out-Null
  Remove-Item $dump -Force -ErrorAction SilentlyContinue
}
