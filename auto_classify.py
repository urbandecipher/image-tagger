"""
auto_classify.py - 根據 tag 自動將圖片分配到集合
執行一次即可，之後可手動微調。
"""
import sqlite3
import json
from pathlib import Path

DB_PATH = "tags.db"

if not Path(DB_PATH).exists():
    print("❌ 找不到 tags.db，請確認在 TagMind 資料夾內執行")
    exit(1)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# ── 取得集合 ID ────────────────────────────────────────────────────────────────
cols = {row["name"]: row["id"] for row in conn.execute("SELECT id, name FROM collections")}
print("📂 已找到集合：", list(cols.keys()))

# 必要集合不存在則建立
needed = ["寫實人物", "動漫人物", "NSFW", "寫實場景", "動漫場景"]
for name in needed:
    if name not in cols:
        cur = conn.execute("INSERT OR IGNORE INTO collections (name) VALUES (?)", (name,))
        cols[name] = cur.lastrowid
        print(f"  ✅ 已建立集合：{name}")
conn.commit()

# ── 分類規則 tag 集合 ──────────────────────────────────────────────────────────
CHARACTER_TAGS = {
    "1girl","2girls","3girls","4girls","5girls","6+girls","multiple girls",
    "1boy","2boys","3boys","multiple boys","1other","androgynous",
    "solo","solo focus",
}
REALISTIC_TAGS = {
    "realistic","photorealistic","photo","real world location",
    "real","live action","3d","cg","photograph",
}
ANIME_TAGS = {
    "anime","manga","comic","animated","cartoon","cel shading",
    "anime style","anime coloring",
}
NSFW_TAGS = {
    "nsfw","nude","naked","explicit","sex","pussy","penis","nipples",
    "topless","bottomless","genitals","cum","orgasm","erection",
    "uncensored","censored bar","vagina","anus","spread legs",
    "sexually suggestive","adult content",
}
SCENE_TAGS = {
    "scenery","landscape","cityscape","architecture","no humans",
    "sky","nature","outdoors","indoors","background","environment",
    "forest","mountain","ocean","city","street","building","room",
    "interior","exterior","vehicle","food","object",
}

def classify(tags: list[str]) -> str | None:
    tag_set = {t.lower() for t in tags}

    # NSFW 優先判斷
    if tag_set & NSFW_TAGS:
        return "NSFW"

    has_character = bool(tag_set & CHARACTER_TAGS)
    has_realistic = bool(tag_set & REALISTIC_TAGS)
    has_anime = bool(tag_set & ANIME_TAGS)
    has_scene = bool(tag_set & SCENE_TAGS)

    if has_character:
        if has_realistic:
            return "寫實人物"
        else:
            return "動漫人物"  # 預設動漫（WD-Tagger 以動漫為主）
    else:
        # 無明確人物 tag
        if has_realistic:
            return "寫實場景"
        elif has_scene:
            return "動漫場景"
        else:
            return None  # 無法判斷，留在未分類

# ── 執行分類 ───────────────────────────────────────────────────────────────────
rows = conn.execute("SELECT id, tags FROM images WHERE tagged = 1").fetchall()
total = len(rows)
print(f"\n🔍 開始分析 {total} 張已打標圖片...")

counts = {name: 0 for name in needed}
skipped = 0
updated = 0

for row in rows:
    tags = json.loads(row["tags"])
    col_name = classify(tags)
    if col_name and col_name in cols:
        conn.execute(
            "UPDATE images SET collection_id = ? WHERE id = ?",
            (cols[col_name], row["id"])
        )
        counts[col_name] += 1
        updated += 1
    else:
        # 留在未分類
        conn.execute("UPDATE images SET collection_id = NULL WHERE id = ?", (row["id"],))
        skipped += 1

conn.commit()
conn.close()

print("\n✅ 自動分類完成！")
print(f"{'─'*30}")
for name, count in counts.items():
    print(f"  {name:<12} {count:>5} 張")
print(f"  {'未分類':<12} {skipped:>5} 張")
print(f"{'─'*30}")
print(f"  共處理 {total} 張，已分類 {updated} 張")
print("\n提示：重新整理瀏覽器後即可看到分類結果，可手動微調分錯的圖片。")
