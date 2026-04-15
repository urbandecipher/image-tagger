"""
launcher.py - PyInstaller 入口點
以獨立視窗啟動 FastAPI 伺服器並開啟瀏覽器
"""
import sys
import os
import threading
import webbrowser
import time

# 設定工作目錄為 exe 所在位置
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

os.chdir(BASE_DIR)

# 將 base dir 加入 path
sys.path.insert(0, BASE_DIR)

from database import Database
from tagger import WDTagger
import uvicorn

def open_browser():
    time.sleep(2)
    webbrowser.open("http://localhost:8000")

if __name__ == "__main__":
    db = Database("tags.db")
    db.init()
    
    tagger = WDTagger()
    tagger.load()
    
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Import app after setting up paths
    from main import app
    uvicorn.run(app, host="127.0.0.1", port=8000)
