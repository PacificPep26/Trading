import json
import os
import time
import re
import sys
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound

sys.stdout.reconfigure(encoding='utf-8')

research_dir = r"D:\victor\Trading\docs\research"
out_dir = os.path.join(research_dir, "tradinglab_transcripts")
os.makedirs(out_dir, exist_ok=True)

with open(os.path.join(research_dir, "tradinglab_videos.json"), "r", encoding="utf-8") as f:
    videos = json.load(f)

print(f"Bắt đầu tải transcript cho {len(videos)} video của TradingLab...")

api = YouTubeTranscriptApi()
results = []
success_count = 0
failed_count = 0

for idx, vid in enumerate(videos, 1):
    vid_id = vid.get("id")
    title = vid.get("title", f"Video_{vid_id}").strip()
    duration = vid.get("duration_string", "")
    url = f"https://www.youtube.com/watch?v={vid_id}"
    
    # Safe filename
    safe_title = re.sub(r'[\\/*?:"<>|]', "", title)
    safe_title = re.sub(r'\s+', "_", safe_title)[:60]
    out_file = os.path.join(out_dir, f"{idx:03d}_{vid_id}_{safe_title}.md")
    
    # Check if already fetched
    transcript_text = ""
    lines = []
    
    try:
        data = api.fetch(vid_id)
        last_t = ""
        for item in data:
            s_sec = int(item.start)
            m, s = divmod(s_sec, 60)
            h, m = divmod(m, 60)
            t_str = f"[{h:02d}:{m:02d}:{s:02d}]"
            t_clean = item.text.replace("\n", " ").replace("&nbsp;", " ").strip()
            if t_clean and t_clean != last_t:
                lines.append(f"{t_str} {t_clean}")
                last_t = t_clean
        transcript_text = "\n".join(lines)
        success_count += 1
    except (TranscriptsDisabled, NoTranscriptFound) as e:
        transcript_text = "Không có phụ đề (No transcript available)"
        failed_count += 1
    except Exception as e:
        # Fallback to en-US or auto
        try:
            transcript_list = api.list(vid_id)
            t = transcript_list.find_transcript(['en', 'en-US', 'en-GB'])
            data = t.fetch()
            last_t = ""
            for item in data:
                s_sec = int(item.start)
                m, s = divmod(s_sec, 60)
                h, m = divmod(m, 60)
                t_str = f"[{h:02d}:{m:02d}:{s:02d}]"
                t_clean = item.text.replace("\n", " ").replace("&nbsp;", " ").strip()
                if t_clean and t_clean != last_t:
                    lines.append(f"{t_str} {t_clean}")
                    last_t = t_clean
            transcript_text = "\n".join(lines)
            success_count += 1
        except Exception as e2:
            transcript_text = f"Lỗi tải phụ đề: {str(e2)[:100]}"
            failed_count += 1
            
    # Write individual transcript file
    doc_content = f"""# {title}

- **Kênh:** TradingLab
- **Video ID:** `{vid_id}`
- **Thời lượng:** {duration}
- **Link YouTube:** [{url}]({url})
- **Trạng thái Transcript:** {"Thành công" if lines else "Không có transcript"}

---

## Toàn bộ lời thoại chi tiết (Full Transcript)

{transcript_text if lines else "*Video này không có phụ đề trên YouTube.*"}
"""
    with open(out_file, "w", encoding="utf-8") as f_out:
        f_out.write(doc_content)
        
    results.append({
        "stt": idx,
        "id": vid_id,
        "title": title,
        "duration": duration,
        "url": url,
        "success": bool(lines),
        "lines_count": len(lines),
        "file_path": out_file,
        "file_name": os.path.basename(out_file),
        "preview": transcript_text[:300].replace("\n", " ") if lines else ""
    })
    
    if idx % 10 == 0 or idx == len(videos):
        print(f"Đã xử lý {idx}/{len(videos)} video... (Thành công: {success_count}, Thất bại/Không có: {failed_count})")
    
    time.sleep(0.15) # Polite delay to avoid any rate limit

with open(os.path.join(research_dir, "tradinglab_results.json"), "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"\nHOÀN TẤT! Đã tải và lưu {success_count} script video vào thư mục: {out_dir}")
