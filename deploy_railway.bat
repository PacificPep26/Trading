@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ======================================================
echo 🚀 [KANE BOT] TRIỂN KHAI LÊN RAILWAY CLOUD
echo ======================================================

echo [1/2] Kiểm tra trạng thái đăng nhập Railway CLI...
railway whoami >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ⚠️ Phiên đăng nhập Railway CLI đã hết hạn.
    echo Đang mở trình duyệt để bạn xác thực (bấm nút Authorize)...
    railway login
)

echo.
echo [2/2] Đang đẩy (push) toàn bộ code mới nhất lên Railway Cloud...
railway up

echo.
echo ======================================================
echo ✅ HOÀN TẤT TRIỂN KHAI LÊN RAILWAY!
echo ======================================================
pause
