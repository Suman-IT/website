[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ExportDir)
$ErrorActionPreference = "Stop"
foreach ($name in @("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "IMPORT_HOSPITAL_ID", "IMPORT_ACTOR_USER_ID")) {
  if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value) { throw "$name is required" }
}
if ($env:IMPORT_CONFIRMATION -ne "I_UNDERSTAND_CLEAN_TARGET") { throw "Set IMPORT_CONFIRMATION to I_UNDERSTAND_CLEAN_TARGET" }
if (-not (Get-Command mysql -ErrorAction SilentlyContinue)) { throw "mysql is required on PATH" }
$metadataPath = Join-Path $ExportDir "metadata.json"
$dump = Join-Path $ExportDir "database.sql"
$checksum = Join-Path $ExportDir "database.sql.sha256"
if (-not (Test-Path $metadataPath) -or -not (Test-Path $dump) -or -not (Test-Path $checksum)) { throw "Export directory is missing required protected artifacts" }
$metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
if ($metadata.kind -ne "protected-migration" -or $metadata.exportVersion -ne 1) { throw "Unsupported migration export" }
$actualHash = (Get-FileHash $dump -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $metadata.sqlSha256) { throw "SQL checksum does not match metadata" }
$expectedHash = (Get-Content $checksum -Raw).Trim().Split()[0]
if ($actualHash -ne $expectedHash) { throw "SQL checksum file does not match dump" }
if ([string]$env:DB_NAME -eq [string]$metadata.sourceDatabase) { throw "Target DB_NAME must differ from sourceDatabase for a rehearsed move" }
$env:MYSQL_PWD = $env:DB_PASSWORD
$port = if ($env:DB_PORT) { $env:DB_PORT } else { "3306" }
$common = @("--host=$($env:DB_HOST)", "--port=$port", "--user=$($env:DB_USER)")
$mysqlTarget = @($common + "--database=$($env:DB_NAME)")
$tableCount = (& mysql @mysqlTarget --batch --raw --skip-column-names --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();" | Out-String).Trim()
if (-not [string]::Equals($tableCount, "0")) { throw "Target database must be empty; refusing to import" }
$importProcess = Start-Process -FilePath "mysql" -ArgumentList $mysqlTarget -RedirectStandardInput $dump -Wait -NoNewWindow -PassThru
if ($importProcess.ExitCode -ne 0) { throw "SQL import failed" }
$auditSql = "INSERT INTO audit_events (hospital_id, actor_user_id, action_code, entity_type, entity_id, details) VALUES ($($env:IMPORT_HOSPITAL_ID),$($env:IMPORT_ACTOR_USER_ID),'portability.import','hospital',$($env:IMPORT_HOSPITAL_ID),JSON_OBJECT('exportVersion',1,'sourceDatabase','$($metadata.sourceDatabase)','sha256','$actualHash'));"
& mysql @mysqlTarget --execute=$auditSql
if ($LASTEXITCODE -ne 0) { throw "Could not record portability import audit" }
$authorized = (& mysql @mysqlTarget --batch --raw --skip-column-names --execute="SELECT COUNT(*) FROM user_roles ur JOIN role_permissions rp ON rp.hospital_id=ur.hospital_id AND rp.role_id=ur.role_id WHERE ur.hospital_id=$($env:IMPORT_HOSPITAL_ID) AND ur.user_id=$($env:IMPORT_ACTOR_USER_ID) AND rp.permission_code='data.import';" | Out-String).Trim()
if ($authorized -ne "1") { throw "Import actor is not authorized for data.import" }
Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
Write-Output "Imported protected migration export into clean target $($env:DB_NAME)."
