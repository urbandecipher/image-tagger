"""
WD-SwinV2-Tagger-V3 inference wrapper.
Model is downloaded automatically from HuggingFace on first run.
"""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
from PIL import Image

MODEL_REPO = "SmilingWolf/wd-swinv2-tagger-v3"
MODEL_FILENAME = "model.onnx"
TAGS_FILENAME = "selected_tags.csv"
LOCAL_DIR = Path("models/wd-swinv2-v3")

INCLUDE_CATEGORIES = {0, 4}   # 0=general, 4=character
EXCLUDE_RATING = True


class WDTagger:
    def __init__(self):
        self.session = None
        self.tags: list[dict] = []
        self.input_name: str = ""
        self.input_size: int = 448

    def load(self):
        self._ensure_model()
        self._load_tags()
        self._load_session()

    def _ensure_model(self):
        LOCAL_DIR.mkdir(parents=True, exist_ok=True)
        model_path = LOCAL_DIR / MODEL_FILENAME
        tags_path  = LOCAL_DIR / TAGS_FILENAME

        if not model_path.exists() or not tags_path.exists():
            print("📥 首次執行：從 HuggingFace 下載模型（約 200 MB），請稍候...")
            try:
                from huggingface_hub import hf_hub_download
                hf_hub_download(MODEL_REPO, MODEL_FILENAME, local_dir=str(LOCAL_DIR))
                hf_hub_download(MODEL_REPO, TAGS_FILENAME,  local_dir=str(LOCAL_DIR))
                print("✅ 模型下載完成")
            except Exception as e:
                raise RuntimeError(f"模型下載失敗: {e}")

    def _load_tags(self):
        tags_path = LOCAL_DIR / TAGS_FILENAME
        self.tags = []
        with open(tags_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                cat = int(row.get("category", 0))
                self.tags.append({"name": row["name"], "category": cat})

    def _load_session(self):
        import onnxruntime as ort
        model_path = str(LOCAL_DIR / MODEL_FILENAME)

        print("⚠️  使用 CPU 模式（日後安裝 CUDA 12 可切換 GPU 加速）")
        self.session = ort.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )
        self.input_name = self.session.get_inputs()[0].name
        shape = self.session.get_inputs()[0].shape
        if isinstance(shape[2], int):
            self.input_size = shape[2]

    def tag_images(self, paths: list[str], threshold: float = 0.35) -> list[list[str]]:
        assert self.session is not None, "Call load() first"
        results = []
        for path in paths:
            try:
                tags = self._tag_single(path, threshold)
            except Exception as e:
                print(f"⚠️  跳過 {path}: {e}")
                tags = []
            results.append(tags)
        return results

    def _tag_single(self, path: str, threshold: float) -> list[str]:
        img = self._preprocess(path)
        outputs = self.session.run(None, {self.input_name: img})
        probs = outputs[0][0]

        result = []
        for prob, tag_info in zip(probs, self.tags):
            if prob < threshold:
                continue
            cat = tag_info["category"]
            if cat == 9 and EXCLUDE_RATING:
                continue
            if cat not in INCLUDE_CATEGORIES:
                continue
            result.append(tag_info["name"].replace("_", " "))
        return result

    def _preprocess(self, path: str) -> np.ndarray:
        with Image.open(path) as im:
            im = im.convert("RGB")
            w, h = im.size
            max_side = max(w, h)
            pad = Image.new("RGB", (max_side, max_side), (255, 255, 255))
            pad.paste(im, ((max_side - w) // 2, (max_side - h) // 2))
            pad = pad.resize((self.input_size, self.input_size), Image.BICUBIC)

        arr = np.array(pad, dtype=np.float32)
        arr = arr[:, :, ::-1]   # RGB → BGR
        arr = np.expand_dims(arr, 0)
        return arr
