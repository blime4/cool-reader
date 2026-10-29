"""Loopback-only, lazy Qwen-Image-2.1 worker. Health never imports torch/downloads weights."""
import argparse
import importlib.util
import io
import json
import os
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODEL = "Qwen/Qwen-Image-2.1"
LOCK = threading.Lock()
PIPELINE = None


def model_location():
    return os.environ.get("QWEN_IMAGE_MODEL", MODEL)


def readiness():
    missing = [name for name in ("torch", "diffusers", "transformers", "accelerate", "PIL")
               if importlib.util.find_spec(name) is None]
    if missing:
        return False, "缺少依赖：" + ", ".join(missing)
    location = model_location()
    if location != MODEL:
        found = Path(location).is_dir() and (Path(location) / "model_index.json").is_file()
    else:
        cache = Path(os.environ.get("HF_HUB_CACHE", str(Path(os.environ.get("HF_HOME", str(Path.home() / ".cache/huggingface"))) / "hub")))
        found = any((cache / "models--Qwen--Qwen-Image-2.1" / "snapshots").glob("*/model_index.json"))
    if not found:
        return False, "模型未就绪：请手动下载完整 Qwen-Image-2.1 快照；探活与生成不会自动下载。"
    return True, "依赖与模型目录已找到；首次生成将加载模型，仍需核验 CUDA/内存与版本兼容。"


def generate_image(data):
    global PIPELINE
    import torch
    from diffusers import QwenImage21Pipeline
    if not torch.cuda.is_available():
        raise RuntimeError("需要 CUDA GPU；请安装匹配的 PyTorch CUDA 版本")
    if PIPELINE is None:
        pipeline = QwenImage21Pipeline.from_pretrained(
            model_location(), torch_dtype=torch.bfloat16, local_files_only=True)
        pipeline.enable_model_cpu_offload()
        if hasattr(pipeline, "vae") and hasattr(pipeline.vae, "enable_tiling"):
            pipeline.vae.enable_tiling()
        PIPELINE = pipeline
    label = data["name"] + (" (" + data["scientificName"] + ")" if data["scientificName"] else "")
    prompt = ("Natural history educational illustration of " + label + ". "
              "A single subject, neutral light background, detailed botanical or zoological illustration. "
              "This is an AI-generated artistic reference, not a field photograph or taxonomic identification. "
              "No text, no labels, no watermark.")
    # Book-guide cards render small. A short 512px draft keeps this fallback usable on 16 GB GPUs;
    # it is deliberately an illustration rather than taxonomic evidence.
    with torch.inference_mode():
        image = PIPELINE(prompt=prompt, width=512, height=512, num_inference_steps=8,
                         generator=torch.Generator("cuda").manual_seed(secrets.randbelow(2**31))).images[0]
    output = io.BytesIO()
    image.convert("RGB").save(output, format="JPEG", quality=90)
    return output.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Do not log names/prompts or tokens.

    def reply(self, status, value):
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self):
        valid_host = self.headers.get("Host") == "127.0.0.1:" + str(self.server.server_port)
        token = self.headers.get("X-Folio-Token", "")
        if not valid_host or self.headers.get("Origin") or not secrets.compare_digest(token, self.server.token):
            self.reply(403, {"error": "Forbidden"})
            return False
        return True

    def do_GET(self):
        if not self.authorized():
            return
        if self.path != "/health":
            return self.reply(404, {"error": "Not found"})
        ready, reason = readiness()
        self.reply(200, {"app": "folio-qwen-image", "model": MODEL, "ready": ready,
                         "reason": reason, "loaded": PIPELINE is not None, "busy": LOCK.locked()})

    def do_POST(self):
        if not self.authorized():
            return
        if self.path != "/generate":
            return self.reply(404, {"error": "Not found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 4096 or self.headers.get_content_type() != "application/json":
                return self.reply(400, {"error": "Invalid JSON request"})
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or not isinstance(data.get("name"), str) or not 1 <= len(data["name"].strip()) <= 120:
                return self.reply(400, {"error": "Invalid name"})
            scientific = data.get("scientificName", "")
            if not isinstance(scientific, str) or len(scientific) > 180 or data.get("kind", "other") not in ("plant", "animal", "bird", "other"):
                return self.reply(400, {"error": "Invalid taxon"})
            data = {"name": data["name"].strip(), "scientificName": scientific, "kind": data.get("kind", "other")}
        except (ValueError, TypeError, UnicodeError):
            return self.reply(400, {"error": "Invalid request"})
        if not LOCK.acquire(blocking=False):
            return self.reply(429, {"error": "An image is already being generated"})
        try:
            ready, reason = readiness()
            if not ready:
                return self.reply(503, {"error": reason})
            image = generate_image(data)
            if len(image) > 8 * 1024 * 1024:
                raise RuntimeError("生成图片超过 8 MB")
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(image)))
            self.end_headers()
            self.wfile.write(image)
        except Exception:
            self.reply(503, {"error": "本地模型推理失败：请检查 Diffusers/CUDA 版本、模型完整性与内存；未生成图片。"})
        finally:
            LOCK.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4174)
    parser.add_argument("--token-file", type=Path, required=True)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Invalid port")
    token = args.token_file.read_text(encoding="utf-8").strip()
    if not 24 <= len(token) <= 256:
        parser.error("Invalid token file")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.token = token
    print("Folio Qwen worker: http://127.0.0.1:" + str(args.port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
