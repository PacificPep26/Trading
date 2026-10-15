"""
add_video.py - Tự động bổ sung video mới vào Master Video Hub với độ ưu tiên số 1
Cách dùng:
    python add_video.py "https://www.youtube.com/watch?v=..."
    hoặc
    python add_video.py "https://www.tiktok.com/@user/video/..."
"""

import sys
import os
import json
import subprocess
import re
from datetime import datetime
import openpyxl

sys.stdout.reconfigure(encoding='utf-8')

if len(sys.argv) < 2:
    print("Vui lòng cung cấp URL video:")
    print('  python add_video.py "<URL_YOUTUBE_HOAC_TIKTOK>"')
    sys.exit(1)

url = sys.argv[1].strip()
research_dir = os.path.dirname(os.path.abspath(__file__))
excel_path = os.path.join(research_dir, "MASTER_VIDEO_DATABASE.xlsx")
md_path = os.path.join(research_dir, "MASTER_VIDEO_HUB.md")
readme_path = os.path.join(research_dir, "README.md")

print(f"Đang xử lý video mới: {url}")

# 1. Fetch metadata with yt-dlp
meta_cmd = ["yt-dlp", "-j", "--skip-download", "--no-warnings", url]
meta_res = subprocess.run(meta_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")

if meta_res.returncode != 0 or not meta_res.stdout.strip():
    print("Lỗi khi lấy thông tin video từ yt-dlp:", meta_res.stderr[:200])
    sys.exit(1)

info = json.loads(meta_res.stdout.strip())
vid_id = info.get("id", "")
title = info.get("title", "Video Mới").strip()
channel = info.get("channel") or info.get("uploader") or "Chưa rõ"
duration = info.get("duration_string", "")
platform = "YouTube" if "youtube" in url or "youtu.be" in url else "TikTok"
date_added = datetime.now().strftime("%Y-%m-%d")

print(f"Nền tảng: {platform} | Kênh: {channel}")
print(f"Tiêu đề: {title} ({duration})")

# 2. Extract transcript
transcript = ""

if platform == "YouTube":
    print("Đang tải phụ đề chính thức từ YouTube...")
    sub_cmd = ["yt-dlp", "--write-sub", "--write-auto-sub", "--sub-lang", "en-orig,en.*,vi.*,en,vi", "--skip-download", "-o", os.path.join(research_dir, "temp_sub.%(ext)s"), url]
    subprocess.run(sub_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    
    # check if temp_sub exists
    found_sub = None
    for f in os.listdir(research_dir):
        if f.startswith("temp_sub") and (f.endswith(".vtt") or f.endswith(".srt")):
            found_sub = os.path.join(research_dir, f)
            break
            
    if found_sub:
        with open(found_sub, "r", encoding="utf-8", errors="ignore") as f:
            sub_raw = f.read()
        # Clean VTT / SRT tags and handle auto-sub deduplication
        blocks = re.findall(r'(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})[^\n]*\n(.*?)(?=\n\d{2}:\d{2}|\Z)', sub_raw, re.DOTALL)
        clean_lines = []
        last_l = ""
        for start, end, body in blocks:
            lines = [re.sub(r'<[^>]+>', '', l).strip() for l in body.split("\n") if l.strip()]
            if lines:
                curr_l = lines[-1]
                if curr_l and curr_l != last_l:
                    clean_lines.append(f"[{start[:8]}] {curr_l}")
                    last_l = curr_l
        transcript = "\n".join(clean_lines) if clean_lines else sub_raw[:5000]
        os.remove(found_sub)
        print(f"Đã trích xuất phụ đề YouTube thành công: {len(transcript)} ký tự ({len(clean_lines)} dòng có timestamp).")
        
elif platform == "TikTok" or not transcript:
    print("Đang tải audio và chuyển giọng nói thành văn bản bằng Whisper AI...")
    temp_audio = os.path.join(research_dir, "temp_audio.mp3")
    dl_audio = ["yt-dlp", "-x", "--audio-format", "mp3", "--audio-quality", "0", "-o", temp_audio, "--no-warnings", url]
    subprocess.run(dl_audio, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    
    if os.path.exists(temp_audio):
        from faster_whisper import WhisperModel
        model = WhisperModel("small", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(temp_audio, language="vi", beam_size=5)
        text_parts = [s.text.strip() for s in segments]
        transcript = " ".join(text_parts)
        os.remove(temp_audio)
        print(f"Đã chuyển giọng nói thành văn bản thành công: {len(transcript)} ký tự.")

if not transcript:
    transcript = info.get("description", "Chưa có lời thoại chi tiết.")

# Summarize rules preview
summary_rules = info.get("description", "").strip()
if not summary_rules:
    summary_rules = transcript[:200] + "..."

# 3. Insert into MASTER_VIDEO_DATABASE.xlsx at Row 2 (Top Priority)
wb = openpyxl.load_workbook(excel_path)
ws = wb.active
new_row = [
    1, # Priority 1
    "🔴 ƯU TIÊN 1 (Mới thêm - Xem ngay)",
    date_added,
    platform,
    channel,
    title,
    summary_rules[:300],
    transcript[:15000],
    duration,
    url
]
ws.insert_rows(2)
for col_idx, val in enumerate(new_row, 1):
    cell = ws.cell(row=2, column=col_idx, value=val)
    if col_idx == 2:
        cell.font = openpyxl.styles.Font(color="FF0000", bold=True)

# Update priority numbering for lower rows
for r in range(3, ws.max_row + 1):
    ws.cell(row=r, column=1, value=r - 1)

wb.save(excel_path)
print("Đã chèn video mới vào HÀNG ĐẦU TIÊN của MASTER_VIDEO_DATABASE.xlsx!")

# 4. Insert into MASTER_VIDEO_HUB.md at top of table and details
with open(md_path, "r", encoding="utf-8") as f:
    md_content = f.read()

# Create table row
short_title = title[:55] + ("..." if len(title) > 55 else "")
short_rules = summary_rules[:60].replace("\n", " ") + "..."
table_row = f"| **#1 (MỚI)** | 🔴 ƯU TIÊN 1 (Xem ngay) | {platform} | **{channel}** | [{short_title}](#new-item-{vid_id}) | {duration} | {short_rules} | [Xem video]({url}) |\n"

# Insert row after table header
table_header = "|:---:|---|:---:|:---:|---|:---:|---|:---:|\n"
if table_header in md_content:
    md_content = md_content.replace(table_header, table_header + table_row)

# Create detail section
detail_section = f"""
<a id='new-item-{vid_id}'></a>
### #1 (MỚI THÊM). [{platform}] {title}

- **Mức độ ưu tiên:** `🔴 ƯU TIÊN 1 (Mới thêm - Xem ngay)`
- **Kênh:** **{channel}** | **Nền tảng:** {platform} | **Thời lượng:** {duration} | **Ngày thêm:** {date_added}
- **Link gốc:** [{url}]({url})

#### 1. Tóm tắt cốt lõi & Quy tắc đo lường (Quantifiable Rules)
> {summary_rules}

#### 2. Toàn bộ lời thoại video nói (Full Transcript)
<details open>
<summary><b>👉 Xem toàn bộ lời thoại chi tiết...</b></summary>

{transcript}

</details>

---
"""

detail_header = "## 📖 CHI TIẾT LỜI THOẠI & QUY TẮC CỦA TỪNG VIDEO (THEO THỨ TỰ ƯU TIÊN)\n\n"
if detail_header in md_content:
    md_content = md_content.replace(detail_header, detail_header + detail_section + "\n")

with open(md_path, "w", encoding="utf-8") as f:
    f.write(md_content)

with open(readme_path, "w", encoding="utf-8") as f:
    f.write(md_content)

print(f"Đã cập nhật MASTER_VIDEO_HUB.md và README.md! Video mới đã được đưa lên vị trí số 1.")

