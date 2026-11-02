# Triển khai bản bot mới lên Railway (tradingview-bot) + nối trang viewer. Chạy trong PowerShell: .\deploy_bot_update.ps1
# Hai lệnh BTC/NEAR đang mở nằm trong volume /data nên được giữ nguyên khi deploy.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "[1/5] Kiểm tra đăng nhập và project..."
railway whoami | Out-Host
railway status | Out-Host
Read-Host "Project phải là 'Trading'. Nhấn Enter để tiếp tục, Ctrl+C để dừng"

Write-Host "[2/5] Chạy kiểm thử..."
npm run check
if ($LASTEXITCODE -ne 0) { throw "npm run check thất bại, dừng deploy" }

Write-Host "[3/5] Đặt biến môi trường cho bot (chưa khởi động lại)..."
# lấy token từ service viewer, không in ra màn hình
$tok = ((railway variables -s viewer --kv) | Where-Object { $_ -like 'VIEWER_TOKEN=*' } | Select-Object -First 1).Split('=', 2)[1].Trim()
railway variable set -s tradingview-bot --skip-deploys `
  "ENABLE_CHOP_SLEEP_MODE=false" "ENABLE_TREND_ALIGN_FILTER=true" "ENABLE_BOX_ALERTS=false" `
  "PORT=8080" "ALERT_STATE_DIR=/data/alerts" `
  "VIEWER_URL=https://viewer-production-232d.up.railway.app" "VIEWER_TOKEN=$tok"

Write-Host "[4/5] Đẩy code mới lên bot..."
railway up --detach -s tradingview-bot

Write-Host "[5/5] Chờ 90 giây rồi xem log khởi động..."
Start-Sleep -Seconds 90
railway logs -s tradingview-bot --lines 60 | Select-String -Pattern "STATE API|POSITIONS ACTIVE|BOT LIVE|Lỗi|Error|SCAN CYCLE" | Select-Object -Last 15

Write-Host ""
$ans = Read-Host "Xóa token Telegram khỏi service Pat để nó ngừng gửi tin vào chat của bot? (y/N)"
if ($ans -eq 'y') {
  railway variable delete TELEGRAM_BOT_TOKEN -s pat-price-action
  railway variable delete TELEGRAM_CHAT_ID -s pat-price-action
}
Write-Host "Xong. Mở https://viewer-production-232d.up.railway.app/ để xem (phải thấy 'Short đang mở' của BTC/NEAR)."
