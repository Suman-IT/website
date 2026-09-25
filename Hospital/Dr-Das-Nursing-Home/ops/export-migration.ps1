[CmdletBinding()]
param([string]$OutputDir = $(if ($env:EXPORT_DIR) { $env:EXPORT_DIR } else { "migration-exports" }))
$ErrorActionPreference = "Stop"
foreach ($name in @("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD", "EXPORT_HOSPITAL_ID", "EXPORT_ACTOR_USER_ID")) {
  if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value) { throw "$name is required" }
}
if ($env:EXPORT_CONFIRMATION -ne "I_UNDERSTAND_PROTECTED_EXPORT") { throw "Set EXPORT_CONFIRMATION to I_UNDERSTAND_PROTECTED_EXPORT" }
if ($env:EXPORT_HOSPITAL_ID -notmatch '^[1-9]\d*$' -or $env:EXPORT_ACTOR_USER_ID -notmatch '^[1-9]\d*$') { throw "Export hospital and actor IDs must be positive decimal IDs" }
if (-not (Get-Command mysqldump -ErrorAction SilentlyContinue)) { throw "mysqldump is required on PATH" }
if (-not (Get-Command mysql -ErrorAction SilentlyContinue)) { throw "mysql is required on PATH" }
$stamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$folder = Join-Path $OutputDir "$($env:DB_NAME)_$stamp"
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$env:MYSQL_PWD = $env:DB_PASSWORD
$port = if ($env:DB_PORT) { $env:DB_PORT } else { "3306" }
$common = @("--host=$($env:DB_HOST)", "--port=$port", "--user=$($env:DB_USER)")
$authorized = (& mysql @common --batch --raw --skip-column-names --database=$env:DB_NAME --execute="SELECT COUNT(*) FROM user_roles ur JOIN role_permissions rp ON rp.hospital_id=ur.hospital_id AND rp.role_id=ur.role_id WHERE ur.hospital_id=$($env:EXPORT_HOSPITAL_ID) AND ur.user_id=$($env:EXPORT_ACTOR_USER_ID) AND rp.permission_code='data.export';" | Out-String).Trim()
if ($authorized -ne "1") { throw "Export actor is not authorized for data.export" }
$dump = Join-Path $folder "database.sql"
& mysqldump @common --single-transaction --quick --routines --events --triggers --hex-blob --set-gtid-purged=OFF $env:DB_NAME | Out-File -FilePath $dump -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw "mysqldump failed" }
$hash = (Get-FileHash $dump -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  database.sql" | Set-Content (Join-Path $folder "database.sql.sha256") -NoNewline
function Export-JsonRows([string]$Name, [string]$Query) {
  $lines = @(& mysql @common --batch --raw --skip-column-names --database=$env:DB_NAME --execute=$Query)
  if ($LASTEXITCODE -ne 0) { throw "Could not export $Name" }
  $items = @($lines | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
  $items | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $folder "$Name.json")
  return $items.Count
}
$counts = [ordered]@{}
$counts.hospital = Export-JsonRows "hospital" "SELECT JSON_OBJECT('id',id,'displayName',display_name,'timezone',timezone,'bookingCutoffMinutes',booking_cutoff_minutes) FROM hospitals WHERE id=$($env:EXPORT_HOSPITAL_ID)"
$counts.departments = Export-JsonRows "departments" "SELECT JSON_OBJECT('id',id,'name',name,'slug',slug,'isPublished',is_published) FROM departments WHERE hospital_id=$($env:EXPORT_HOSPITAL_ID)"
$counts.doctors = Export-JsonRows "doctors" "SELECT JSON_OBJECT('id',id,'displayName',display_name,'slug',slug,'isActive',is_active,'isPublished',is_published) FROM doctors WHERE hospital_id=$($env:EXPORT_HOSPITAL_ID)"
$counts.schedules = Export-JsonRows "schedules" "SELECT JSON_OBJECT('id',id,'doctorId',doctor_id,'dayOfWeek',day_of_week,'startLocal',start_local,'endLocal',end_local,'bookingMode',booking_mode,'capacity',capacity,'slotMinutes',slot_minutes,'validFrom',valid_from,'validUntil',valid_until,'isActive',is_active) FROM doctor_schedules WHERE hospital_id=$($env:EXPORT_HOSPITAL_ID)"
$counts.patients = Export-JsonRows "patients" "SELECT JSON_OBJECT('id',id,'fullName',full_name,'mobile',mobile_normalized,'createdAtUtc',created_at_utc) FROM patients WHERE hospital_id=$($env:EXPORT_HOSPITAL_ID)"
$counts.appointments = Export-JsonRows "appointments" "SELECT JSON_OBJECT('id',a.id,'reference',a.public_reference,'patientId',a.patient_id,'doctorId',a.doctor_id,'status',a.status,'source',a.booking_source,'serialNumber',a.serial_number,'date',s.service_date,'estimatedStartAtUtc',a.estimated_start_at_utc,'slotStartAtUtc',a.slot_start_at_utc) FROM appointments a JOIN appointment_sessions s ON s.hospital_id=a.hospital_id AND s.id=a.session_id WHERE a.hospital_id=$($env:EXPORT_HOSPITAL_ID)"
$counts.overrides = Export-JsonRows "schedule-overrides" "SELECT JSON_OBJECT('id',o.id,'scheduleId',o.schedule_id,'serviceDate',o.service_date,'isAvailable',o.is_available,'startLocal',o.start_local,'endLocal',o.end_local,'capacity',o.capacity,'slotMinutes',o.slot_minutes) FROM schedule_overrides o WHERE o.hospital_id=$($env:EXPORT_HOSPITAL_ID)"
$metadata = [ordered]@{ exportVersion = 1; kind = "protected-migration"; createdAtUtc = $stamp; sourceDatabase = $env:DB_NAME; hospitalId = $env:EXPORT_HOSPITAL_ID; schemaMigration = $(if ($env:SCHEMA_MIGRATION) { $env:SCHEMA_MIGRATION } else { "unknown" }); encoding = "utf-8"; timezone = "UTC storage; hospital timezone is in hospital.json"; sqlSha256 = $hash; files = @("database.sql", "database.sql.sha256", "hospital.json", "departments.json", "doctors.json", "schedules.json", "schedule-overrides.json", "patients.json", "appointments.json"); entityCounts = $counts; includesCredentialHashesOnlyInProtectedSql = $true; actorUserId = $env:EXPORT_ACTOR_USER_ID }
$metadata | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $folder "metadata.json")
$auditSql = "INSERT INTO audit_events (hospital_id, actor_user_id, action_code, entity_type, entity_id, details) VALUES ($($env:EXPORT_HOSPITAL_ID),$($env:EXPORT_ACTOR_USER_ID),'portability.export','hospital',$($env:EXPORT_HOSPITAL_ID),JSON_OBJECT('exportVersion',1,'createdAtUtc','$stamp','sha256','$hash'));"
& mysql @common --database=$env:DB_NAME --execute=$auditSql
if ($LASTEXITCODE -ne 0) { throw "Could not record portability export audit" }
Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
Write-Output "Created protected migration export: $folder"
Write-Output "SQL SHA256: $hash"
