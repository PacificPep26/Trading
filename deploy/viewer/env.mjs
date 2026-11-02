// Phải chạy TRƯỚC khi nạp config của bot: cùng cấu hình đã backtest (chop-sleep tắt, lọc BOS H4 bật). Biến môi trường Railway vẫn ghi đè được.
process.env.ENABLE_CHOP_SLEEP_MODE ??= 'false';
process.env.ENABLE_TREND_ALIGN_FILTER ??= 'true';
