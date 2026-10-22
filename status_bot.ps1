$procs = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
    $_.CommandLine -match "Bot Trade.*server\.js" -or $_.CommandLine -match "src[/\\]server\.js"
}

if ($procs) {
    Write-Host "=========================================================="
    Write-Host "[KANE BOT] RUNNING 24/7 - PID: $($procs.ProcessId -join ', ')"
    Write-Host "=========================================================="
} else {
    Write-Host "=========================================================="
    Write-Host "[KANE BOT] STOPPED"
    Write-Host "=========================================================="
}

$logFile = "d:\victor\Bot Trade\logs\live.log"
if (Test-Path $logFile) {
    Write-Host "`n--- 15 DONG LOG MOI NHAT ---"
    Get-Content $logFile -Tail 15
    Write-Host "----------------------------"
}

