$workingDir = "d:\victor\Bot Trade"
$logDir = Join-Path $workingDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir "live.log"

# Dừng tiến trình server.js của Bot Trade nếu có (tránh nhầm với MCP server)
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
    $_.CommandLine -match "Bot Trade.*server\.js" -or $_.CommandLine -match "src[/\\]server\.js"
} | ForEach-Object {
    Write-Host "Dừng tiến trình Kane Bot cũ (PID: $($_.ProcessId))..."
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# Tạo tiến trình nền hoàn toàn độc lập qua WMI (thoát khỏi Job Object)
$cmd = "cmd.exe /c node ""$workingDir\src\server.js"" >> ""$logFile"" 2>&1"
$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = $workingDir
}

if ($res.ReturnValue -eq 0) {
    Write-Host "=========================================================="
    Write-Host "✅ [KANE BOT 24/7] Bot đã được kích hoạt chạy nền 24/7!"
    Write-Host "   • PID: $($res.ProcessId)"
    Write-Host "   • Working Dir: $workingDir"
    Write-Host "   • Log File: $logFile"
    Write-Host "=========================================================="
} else {
    Write-Host "❌ Khởi động thất bại với mã lỗi: $($res.ReturnValue)"
}

