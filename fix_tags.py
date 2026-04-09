"""
一次性修復腳本：把資料庫裡所有 tag 的底線統一轉換成空格。
執行一次即可，之後不需要再跑。
"""
import sqlite3
import json
from pathlib import Path

DB_PATH = "tags.db"

if not Path(DB_PATH).exists():
    print("❌ 找不到 tags.db，請確認在 image-tagger 資料夾內執行")
    exit(1)

conn = sqlite3.connect(DB_PATH)
rows = conn.execute("SELECT id, tags FROM images WHERE tagged = 1").fetchall()

fixed = 0
for row_id, tags_json in rows:
    tags = json.loads(tags_json)
    new_tags = [t.replace("_", " ") for t in tags]
    if new_tags != tags:
        conn.execute(
            "UPDATE images SET tags = ? WHERE id = ?",
            (json.dumps(new_tags, ensure_ascii=False), row_id)
        )
        fixed += 1

conn.commit()
conn.close()
print(f"✅ 修復完成！共更新 {fixed} 筆記錄，共掃描 {len(rows)} 張圖片")
