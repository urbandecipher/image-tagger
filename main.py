import asyncio
import json
import re
import threading
import webbrowser
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import Database
from tagger import WDTagger

app = FastAPI(title="Image Tagger")
app.mount("/static", StaticFiles(directory="static"), name="static")
db = Database("tags.db")
tagger = WDTagger()

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
CONFIG_FILE = Path("config.json")


# ── Config ────────────────────────────────────────────────────────────────────
def load_config() -> dict:
    defaults = {"last_folder": "", "threshold": 0.35, "theme": "tactical"}
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            return {**defaults, **data}
        except Exception:
            pass
    return defaults

def save_config(data: dict):
    CONFIG_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ── Job state ─────────────────────────────────────────────────────────────────
job_state = {
    "running": False, "total": 0, "done": 0, "current": "", "errors": [],
}


# ── Models ────────────────────────────────────────────────────────────────────
class ScanRequest(BaseModel):
    folder: str

class TagRequest(BaseModel):
    folder: str
    threshold: float = 0.35
    batch_size: int = 8

class UpdateTagsRequest(BaseModel):
    image_id: int
    tags: list[str]

class DeleteRequest(BaseModel):
    image_id: int

class BulkDeleteRequest(BaseModel):
    image_ids: list[int]
    delete_files: bool = True

class BulkMoveRequest(BaseModel):
    image_ids: list[int]
    target_folder: str

class BulkCollectionRequest(BaseModel):
    image_ids: list[int]
    collection_id: Optional[int] = None

class ConfigRequest(BaseModel):
    last_folder: str = ""
    threshold: float = 0.35
    theme: str = "tactical"

class AddCollectionRequest(BaseModel):
    name: str

class RenameCollectionRequest(BaseModel):
    collection_id: int
    name: str


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def root():
    html_path = Path(__file__).parent / "static" / "index.html"
    return HTMLResponse(content=html_path.read_text(encoding="utf-8"))

@app.get("/api/config")
async def get_config():
    return load_config()

@app.post("/api/config")
async def set_config(req: ConfigRequest):
    cfg = load_config()
    cfg["last_folder"] = req.last_folder
    cfg["threshold"] = req.threshold
    cfg["theme"] = req.theme
    save_config(cfg)
    return {"status": "ok"}

@app.get("/api/stats")
async def get_stats():
    return {"total": db.count_images(), "untagged": db.count_untagged()}


# ── Collections ───────────────────────────────────────────────────────────────
@app.get("/api/collections")
async def get_collections():
    cols, uncollected = db.get_collections()
    return {"collections": cols, "uncollected": uncollected}

@app.post("/api/collections")
async def add_collection(req: AddCollectionRequest):
    cid = db.add_collection(req.name)
    return {"id": cid, "name": req.name}

@app.put("/api/collections")
async def rename_collection(req: RenameCollectionRequest):
    db.rename_collection(req.collection_id, req.name)
    return {"status": "ok"}

@app.delete("/api/collections/{collection_id}")
async def delete_collection(collection_id: int):
    db.delete_collection(collection_id)
    return {"status": "ok"}

@app.post("/api/images/set-collection")
async def set_collection(req: BulkCollectionRequest):
    db.set_images_collection(req.image_ids, req.collection_id)
    return {"status": "ok", "count": len(req.image_ids)}


# ── Scan ──────────────────────────────────────────────────────────────────────
@app.post("/api/scan")
async def scan_folder(req: ScanRequest):
    folder = Path(req.folder)
    if not folder.exists() or not folder.is_dir():
        raise HTTPException(400, "資料夾不存在")
    images = [str(p) for p in folder.rglob("*") if p.suffix.lower() in SUPPORTED_EXTS]
    new_count = 0
    for img_path in images:
        if db.get_image_by_path(img_path) is None:
            db.add_image(img_path)
            new_count += 1
    cfg = load_config()
    cfg["last_folder"] = str(folder)
    save_config(cfg)
    # Record scan history
    db.upsert_scan_history(str(folder), len(images))
    return {"total": db.count_images(), "new": new_count, "untagged": db.count_untagged()}


@app.get("/api/scan-history")
async def get_scan_history():
    return db.get_scan_history()

class DeleteScanHistoryRequest(BaseModel):
    folder: str

@app.delete("/api/scan-history")
async def delete_scan_history(req: DeleteScanHistoryRequest):
    db.delete_scan_history(req.folder)
    return {"status": "ok"}


# ── Tagging ───────────────────────────────────────────────────────────────────
@app.post("/api/tag")
async def start_tagging(req: TagRequest, background_tasks: BackgroundTasks):
    if job_state["running"]:
        raise HTTPException(409, "已有打標任務進行中")
    folder = Path(req.folder)
    if not folder.exists():
        raise HTTPException(400, "資料夾不存在")
    cfg = load_config()
    cfg["threshold"] = req.threshold
    save_config(cfg)
    background_tasks.add_task(run_tagging_job, req.folder, req.threshold, req.batch_size)
    return {"status": "started"}

@app.get("/api/tag/progress")
async def tag_progress():
    return job_state


# ── Images ────────────────────────────────────────────────────────────────────
@app.get("/api/images")
async def list_images(
    query: str = "",
    page: int = 1,
    per_page: int = 50,
    untagged_only: bool = False,
    collection_id: Optional[int] = None,
    uncollected: bool = False,
):
    query = query.replace("+", " ")
    tags = [t.strip() for t in re.split(r",", query) if t.strip()]
    images, total = db.search_images(
        tags, page, per_page, untagged_only,
        collection_id=collection_id,
        uncollected=uncollected,
    )
    return {"images": images, "total": total, "page": page, "per_page": per_page}

@app.get("/api/image/{image_id}")
async def get_image(image_id: int):
    img = db.get_image(image_id)
    if img is None:
        raise HTTPException(404, "找不到圖片")
    return img

@app.get("/api/thumb/{image_id}")
async def get_thumbnail(image_id: int):
    img = db.get_image(image_id)
    if img is None:
        raise HTTPException(404)
    thumb_dir = Path("thumbnails")
    thumb_dir.mkdir(exist_ok=True)
    thumb_path = thumb_dir / f"{image_id}.jpg"
    if not thumb_path.exists():
        from PIL import Image
        try:
            with Image.open(img["path"]) as im:
                im.thumbnail((256, 256))
                im = im.convert("RGB")
                im.save(thumb_path, "JPEG", quality=80)
        except Exception:
            raise HTTPException(500, "縮圖生成失敗")
    return FileResponse(thumb_path, media_type="image/jpeg")

@app.get("/api/full/{image_id}")
async def get_full_image(image_id: int):
    img = db.get_image(image_id)
    if img is None:
        raise HTTPException(404)
    path = Path(img["path"])
    if not path.exists():
        raise HTTPException(404, "原始圖片不存在")
    suffix = path.suffix.lower()
    media = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp",
        ".gif": "image/gif", ".bmp": "image/bmp",
    }.get(suffix, "image/jpeg")
    return FileResponse(str(path), media_type=media)

@app.put("/api/image/tags")
async def update_tags(req: UpdateTagsRequest):
    db.update_tags(req.image_id, req.tags)
    return {"status": "ok"}

@app.delete("/api/image")
async def delete_image(req: DeleteRequest):
    db.delete_image(req.image_id)
    return {"status": "ok"}

@app.get("/api/tags/all")
async def all_tags(collection_id: Optional[int] = None, uncollected: bool = False):
    return db.get_all_tags(collection_id=collection_id, uncollected=uncollected)


# ── Bulk ops ──────────────────────────────────────────────────────────────────
@app.post("/api/images/bulk-delete")
async def bulk_delete(req: BulkDeleteRequest):
    results = {"deleted": 0, "errors": []}
    for image_id in req.image_ids:
        img = db.get_image(image_id)
        if img is None:
            continue
        if req.delete_files:
            try:
                p = Path(img["path"])
                if p.exists():
                    p.unlink()
                thumb = Path("thumbnails") / f"{image_id}.jpg"
                if thumb.exists():
                    thumb.unlink()
            except Exception as e:
                results["errors"].append(f"{img['path']}: {e}")
                continue
        db.delete_image(image_id)
        results["deleted"] += 1
    return results

@app.post("/api/images/bulk-move")
async def bulk_move(req: BulkMoveRequest):
    target = Path(req.target_folder)
    if not target.exists():
        try:
            target.mkdir(parents=True)
        except Exception as e:
            raise HTTPException(400, f"無法建立目標資料夾: {e}")
    results = {"moved": 0, "errors": []}
    for image_id in req.image_ids:
        img = db.get_image(image_id)
        if img is None:
            continue
        src = Path(img["path"])
        if not src.exists():
            results["errors"].append(f"找不到檔案: {src}")
            continue
        dst = target / src.name
        if dst.exists():
            stem, suffix, i = src.stem, src.suffix, 1
            while dst.exists():
                dst = target / f"{stem}_{i}{suffix}"
                i += 1
        try:
            src.rename(dst)
            db.update_image_path(image_id, str(dst))
            thumb = Path("thumbnails") / f"{image_id}.jpg"
            if thumb.exists():
                thumb.unlink()
            results["moved"] += 1
        except Exception as e:
            results["errors"].append(f"{src.name}: {e}")
    return results

@app.get("/api/reveal/{image_id}")
async def reveal_in_explorer(image_id: int):
    import subprocess
    img = db.get_image(image_id)
    if img is None:
        raise HTTPException(404, "找不到圖片")
    path = Path(img["path"])
    if not path.exists():
        raise HTTPException(404, "檔案不存在")
    subprocess.Popen(f'explorer /select,"{path}"')
    return {"status": "ok"}


# ── Background job ────────────────────────────────────────────────────────────
async def run_tagging_job(folder: str, threshold: float, batch_size: int):
    job_state["running"] = True
    job_state["errors"] = []
    untagged = db.get_untagged_images()
    folder_path = str(Path(folder))
    untagged = [u for u in untagged if u["path"].startswith(folder_path)]
    job_state["total"] = len(untagged)
    job_state["done"] = 0
    loop = asyncio.get_event_loop()
    for i in range(0, len(untagged), batch_size):
        batch = untagged[i: i + batch_size]
        paths = [b["path"] for b in batch]
        ids = [b["id"] for b in batch]
        job_state["current"] = Path(paths[0]).name
        try:
            results = await loop.run_in_executor(None, tagger.tag_images, paths, threshold)
            for img_id, tags in zip(ids, results):
                db.update_tags(img_id, tags)
        except Exception as e:
            job_state["errors"].append(str(e))
        job_state["done"] += len(batch)
    job_state["running"] = False
    job_state["current"] = ""


# ── Entry ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    db.init()
    tagger.load()
    print("✅ WD-Tagger 模型載入完成")
    print("🌐 http://localhost:8000")

    def open_browser():
        import time
        time.sleep(1.5)
        webbrowser.open("http://localhost:8000")

    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=8000)
