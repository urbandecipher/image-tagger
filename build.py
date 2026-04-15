"""
打包腳本：執行後在 dist/ 資料夾生成 ImageTagStudio.exe
需先安裝：pip install pyinstaller
"""
import subprocess, sys

cmd = [
    sys.executable, "-m", "PyInstaller",
    "--noconfirm",
    "--onefile",
    "--windowed",
    "--icon=static/icon.ico",
    "--name=ImageTagStudio",
    "--add-data=static;static",
    "--add-data=models;models",
    "--hidden-import=uvicorn.logging",
    "--hidden-import=uvicorn.loops",
    "--hidden-import=uvicorn.loops.auto",
    "--hidden-import=uvicorn.protocols",
    "--hidden-import=uvicorn.protocols.http",
    "--hidden-import=uvicorn.protocols.http.auto",
    "--hidden-import=uvicorn.protocols.websockets",
    "--hidden-import=uvicorn.protocols.websockets.auto",
    "--hidden-import=uvicorn.lifespan",
    "--hidden-import=uvicorn.lifespan.on",
    "--hidden-import=fastapi",
    "--hidden-import=onnxruntime",
    "launcher.py",
]
subprocess.run(cmd, check=True)
print("\n✅ 打包完成！執行檔在 dist/ImageTagStudio.exe")
