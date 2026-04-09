<div align="center">
  <img src="static/icon.ico" width="80" alt="ImageTag Studio">
  <h1>ImageTag Studio</h1>
  <p>本地 AI 圖片打標工具 · Local AI Image Tagger</p>

  ![Python](https://img.shields.io/badge/Python-3.10+-blue?style=flat-square)
  ![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)
  ![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey?style=flat-square)
</div>

---

## ✨ 功能特色

- 🤖 **本地 AI 打標** — 使用 WD-SwinV2-Tagger-V3 模型，完全離線，無需 API Key
- 🔍 **中英文搜索** — 支援輸入中文自動轉換英文 tag 搜索
- 🏷️ **分類 Tag 面板** — 人物、髮型、表情、服裝、場景等分類瀏覽
- ✏️ **手動編輯 Tag** — 點擊圖片可新增、刪除、修改 tag
- 📂 **一鍵開啟資料夾** — 在系統檔案總管中定位原始圖片
- 🌙 **亮/暗主題** — 支援切換，偏好自動記憶
- 🌐 **中英雙語介面** — 支援切換顯示語言

---

## 📋 系統需求

| 項目 | 需求 |
|------|------|
| 作業系統 | Windows 10 / 11 |
| Python | 3.10 以上 |
| 顯示卡 | NVIDIA GPU（建議，CPU 也可運行） |
| CUDA | 12.x（GPU 加速需要，CPU 模式不需要） |
| 磁碟空間 | 約 500 MB（含模型） |

---

## 🚀 安裝與啟動

### 方法一：直接執行（推薦新手）

```bash
# 1. 複製此專案
git clone https://github.com/your-username/image-tagger.git
cd image-tagger

# 2. 建立虛擬環境
python -m venv venv
venv\Scripts\activate

# 3. 安裝依賴
pip install -r requirements.txt

# 4. 啟動（首次會自動下載模型約 200 MB）
start.bat
```

### 方法二：打包成 exe

```bash
pip install pyinstaller
python build.py
# 生成 dist/ImageTagStudio.exe，雙擊即可使用
```

---

## 📖 使用說明

詳細使用教程請參閱 [docs/guide.html](docs/guide.html)

### 快速上手

1. 啟動後瀏覽器自動開啟 `http://localhost:8000`
2. 在左側輸入圖片資料夾路徑，點「掃描資料夾」
3. 點「開始打標」，等待 AI 自動分析所有圖片
4. 使用搜索框或左側 Tag 分類面板篩選圖片
5. 點擊任意圖片可查看、編輯 tag

### 搜索技巧

| 操作 | 說明 |
|------|------|
| 輸入英文 | `brown hair` 搜索棕髮圖片 |
| 輸入中文 | `棕髮` 自動轉換搜索 |
| 多個條件 | `brown hair,smile` 逗號分隔 |
| 點擊 Tag | 左側 Tag 面板點選直接篩選 |

---

## 🗂️ 專案結構

```
image-tagger/
├── main.py          # FastAPI 後端
├── tagger.py        # WD-Tagger AI 推理
├── database.py      # SQLite 資料庫操作
├── launcher.py      # PyInstaller 啟動入口
├── build.py         # 打包腳本
├── fix_tags.py      # 資料庫修復工具
├── start.bat        # Windows 快速啟動
├── static/
│   ├── index.html   # 前端介面
│   └── icon.ico     # 應用程式圖示
├── docs/
│   └── guide.html   # 使用教程
├── requirements.txt
├── .gitignore
└── README.md
```

---

## ⚙️ 常見問題

**Q: 第一次啟動很慢？**  
A: 首次啟動會從 HuggingFace 下載模型（約 200 MB），之後秒開。

**Q: 速度如何？**  
A: NVIDIA RTX 系列約 3-8 張/秒；CPU 模式約 0.5-1 張/秒。

**Q: 支援哪些圖片格式？**  
A: JPG、PNG、WebP、GIF、BMP。

**Q: Tag 都是英文？**  
A: WD-Tagger 輸出為英文，介面提供中文對照翻譯及中文搜索轉換。

**Q: 資料存在哪裡？**  
A: `tags.db`（SQLite），在本機資料夾內，不會上傳任何資料。

---

## 📄 授權

MIT License © 2026
