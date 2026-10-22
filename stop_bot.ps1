Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
    $_.CommandLine -match "Bot Trade.*server\.js" -or $_.CommandLine -match "src[/\\]server\.js"
} | ForEach-Object {
    Write-Host "Đang dừng Kane Bot (PID: $($_.ProcessId))..."
    Stop-Process -Id $_.ProcessId -Force
}
Write-Host "✅ [KANE BOT] Đã dừng Bot thành công!"

