"""Freeze synthetic Eval inputs and intercept pinned old request builders, offline.

No package entrypoint, host queue, model loader, provider or service is started.
The source functions are selected from verified ASTs without importing old packages.
"""
import argparse
import ast
import asyncio
import base64
from contextlib import asynccontextmanager, contextmanager
import hashlib
import io
import json
import math
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import types
import zipfile
from unittest.mock import patch

try:
    from .request_contract import canonical, sha256, validate_payload
except ImportError:
    from request_contract import canonical, sha256, validate_payload

ROOT = Path(__file__).resolve().parents[2]
BUSINESS = "7ff56cb51ef6f7fc3bcf5707792d655037c61b30"
HOST = "3c1b7a17fdf239d35ce98cc777756f572d089795"
PACKAGE = "ComfyUI-DAELab-Custom-Nodes-Library"
ARCHIVE_SHA256 = "0b8cefcb8951157093f55036d4e15010c7a279e9b4f2ccfc629140684b4e81a1"


def file_hash(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def save_new(path, value):
    path = Path(path)
    data = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("Refusing to replace existing preparation evidence.")
    else:
        with path.open("xb") as output:
            output.write(data)


def safe_relative(root, relative):
    root, path = Path(root).resolve(), (Path(root) / relative).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError("Fixture path must stay inside its declared root.")
    return path


class Sources:
    """Every old file must match the fixed archive manifest, never the working tree."""
    def __init__(self, baseline_root, runtime):
        self.baseline = Path(baseline_root).resolve()
        prepared = json.loads((self.baseline / "prepared.json").read_text("utf-8"))
        snapshot = next(s for s in prepared["snapshots"] if s["name"] == PACKAGE)
        if snapshot["source_commit"] != BUSINESS or runtime["sourceBaselines"]["business"]["commit"] != BUSINESS or runtime["host"]["gitHead"] != HOST:
            raise ValueError("Baseline commit identity does not match the fixed Eval source.")
        if snapshot["archive_sha256"] != ARCHIVE_SHA256 or file_hash(snapshot["archive"]) != ARCHIVE_SHA256:
            raise ValueError("Fixed old archive changed; preserve evidence and prepare again.")
        self.root = self.baseline / "custom_nodes" / PACKAGE
        self.archive = Path(snapshot["archive"])
        self.expected = {f["path"]: f["sha256"] for f in snapshot["files"]}
        self.used = {}

    def read(self, relative):
        path = safe_relative(self.root, relative)
        actual = file_hash(path)
        with zipfile.ZipFile(self.archive) as archive:
            archived = hashlib.sha256(archive.read(relative)).hexdigest()
        if self.expected.get(relative) != actual or archived != actual:
            raise ValueError("Old source differs from its archived commit.")
        self.used[relative] = {"commit": BUSINESS, "sha256": actual}
        return path.read_text("utf-8")

    def module_closure(self, relative):
        seen = set()
        def visit(name):
            if name in seen:
                return
            seen.add(name)
            text = self.read(name)
            for child in re.findall(r"(?:from\s*|import\s*)['\"]([^'\"]+)['\"]", text):
                if not child.startswith("."):
                    raise ValueError("Only local pure ESM imports are permitted in the capture builder.")
                file = safe_relative(self.root, str(Path(name).parent / child.split("?", 1)[0]))
                visit(file.relative_to(self.root).as_posix())
        visit(relative)


def selected(source, names, namespace, filename="<verified-baseline>"):
    """Execute exact complete definitions; omit all unrelated package registration."""
    wanted = set(names)
    def root_name(target):
        while isinstance(target, (ast.Subscript, ast.Attribute)):
            target = target.value
        return target.id if isinstance(target, ast.Name) else None
    tree = ast.parse(source, filename=filename)
    body = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name in wanted:
            body.append(node)
        elif isinstance(node, ast.Assign) and any(root_name(target) in wanted for target in node.targets):
            body.append(node)
    exec(compile(ast.Module(body=body, type_ignores=[]), filename, "exec"), namespace)
    if any(name not in namespace for name in wanted):
        raise ValueError("A required source definition is unavailable.")
    return namespace


def synthetic_images(root):
    from PIL import Image, ImageDraw
    definitions = {
        "vision-counts.png": (1536, 1024, "counts"),
        "vision-relations.png": (768, 512, "relations"),
        "motion-first.png": (640, 360, "first"),
        "motion-last.png": (768, 512, "last"),
    }
    result = []
    for filename, (width, height, scene) in definitions.items():
        image = Image.new("RGB", (width, height), (244, 243, 237))
        draw = ImageDraw.Draw(image)
        def rectangle(box, color):
            draw.rectangle(tuple(round(v * (width if i % 2 == 0 else height)) for i, v in enumerate(box)), fill=color)
        def ellipse(box, color):
            draw.ellipse(tuple(round(v * (width if i % 2 == 0 else height)) for i, v in enumerate(box)), fill=color)
        if scene == "counts":
            rectangle((.12, .2, .3, .5), (194, 35, 47))
            rectangle((.35, .3, .49, .5), (194, 35, 47))
            ellipse((.61, .23, .82, .55), (32, 93, 190))
        elif scene == "relations":
            rectangle((.2, .2, .8, .8), (34, 95, 190))
            ellipse((.4, .48, .72, .88), (235, 179, 30))
            rectangle((.1, .1, .25, .3), (194, 35, 47))
        else:
            rectangle((0, .75, 1, 1), (225, 223, 215))
            rectangle((.67, .32, .81, .59), (34, 95, 190))
            x = .24 if scene == "first" else .52
            ellipse((x - .07, .43, x + .07, .65), (194, 35, 47))
        stream = io.BytesIO()
        image.save(stream, format="PNG", compress_level=9)
        path = safe_relative(root, "images/" + filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = stream.getvalue()
        if path.exists() and path.read_bytes() != data:
            raise ValueError("Synthetic image changed; do not overwrite a frozen fixture.")
        if not path.exists():
            with path.open("xb") as output:
                output.write(data)
        result.append({"path": "images/" + filename, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "width": width, "height": height, "origin": "deterministic synthetic RGB geometry; no metadata or historical media"})
    return result


_NODE_FREEZE = r'''
import fs from 'node:fs'; import net from 'node:net'; import http from 'node:http'; import https from 'node:https'; import tls from 'node:tls'; import child from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const denied=()=>{throw Error('Capture forbids network and child execution');};
globalThis.fetch=denied;net.Socket.prototype.connect=denied;net.connect=denied;net.createConnection=denied;tls.connect=denied;
http.request=http.get=https.request=https.get=denied;
for(const key of ['exec','execFile','spawn','fork','execSync','execFileSync','spawnSync'])child[key]=denied;
syncBuiltinESMExports();
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const m=await import(input.module);
const revisions=new m.OptimizationRevisions();
const result=[];
for(const sample of input.samples){
 const frozen=await m.freezeSnapshot(input.table,{documentId:'local-eval-document',tableId:'local-eval-table',recordId:sample.recordId,fieldId:sample.fieldId},revisions,
 {model:m.QWEN_MODEL,requirements:sample.requirements,maxOutputTokens:sample.maxOutputTokens,nonce:sample.nonce,begin:true});
 result.push({sampleId:sample.id,snapshot:frozen.wire});
}
process.stdout.write(JSON.stringify(result));
'''


def freeze_table(sources, fixtures, node="node"):
    relative = "web/prompt_optimization_model.mjs"
    sources.module_closure(relative)
    payload = {"module": (sources.root / relative).as_uri(), "table": fixtures["table"], "samples": [s for s in fixtures["samples"] if s["entry"] == "table-row"]}
    completed = subprocess.run([node, "--input-type=module", "-e", _NODE_FREEZE], input=json.dumps(payload, ensure_ascii=False), encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=30)
    if completed.returncode:
        raise ValueError("Pinned table snapshot capture failed; no request was submitted. " + completed.stderr[-1200:])
    return {item["sampleId"]: item["snapshot"] for item in json.loads(completed.stdout)}


class CapturedRequest(Exception):
    def __init__(self, body):
        self.body = json.loads(json.dumps(body))


def denied(*args, **kwargs):
    raise RuntimeError("Offline preparation forbids network and process execution.")


@contextmanager
def no_external_io():
    # The asyncio loop is created first: Windows uses a private self-pipe socket.
    with patch.object(socket.socket, "connect", denied), patch.object(socket.socket, "connect_ex", denied), patch.object(socket.socket, "sendto", denied), patch.object(socket, "getaddrinfo", denied), patch.object(subprocess, "Popen", denied):
        yield


def capture_qwen(sources, sample, fixture_root, snapshot, work):
    import aiohttp
    from PIL import Image, ImageOps
    q = {"asyncio": asyncio, "base64": base64, "io": io, "Image": Image, "ImageOps": ImageOps, "aiohttp": aiohttp,
         "_active": False, "_quarantined": False,
         "_server": types.SimpleNamespace(port=8000, prompt_queue=types.SimpleNamespace(get_current_queue=lambda: ([], [])))}
    # The 8000 value is a branch sentinel in an in-memory server double, not a URL.
    # It prevents the old cross-instance GET from touching production at all.
    @asynccontextmanager
    async def admission():
        yield
    async def unloaded():
        return None
    async def intercept(path, payload=None, **kwargs):
        if path != "/api/generate" or not payload or "prompt" not in payload:
            raise RuntimeError("Unexpected transport action during capture.")
        raise CapturedRequest(payload)
    q.update(admission=admission, ensure_unloaded=unloaded, lock_path=lambda: work / "synthetic-gate", request=intercept)
    selected(sources.read("nodes/prompt_optimization/local_qwen.py"), ["MODEL", "image_payload", "_generate", "generate"], q)
    mm = types.ModuleType("comfy.model_management")
    mm.unload_all_models = mm.soft_empty_cache = lambda: None
    comfy = types.ModuleType("comfy")
    comfy.model_management = mm
    if sample["entry"] == "table-row":
        limits = selected(sources.read("nodes/prompt_optimization/pricing.py"), ["MODEL_LIMITS", "QWEN_MODEL", "COMFY_GPT_MODEL"], {})
        instructions = selected(sources.read("nodes/prompt_optimization/instructions.py"), ["INSTRUCTIONS"], {})["INSTRUCTIONS"]
        transport = selected(sources.read("nodes/prompt_optimization/qwen.py"), ["QwenTransport"], {"local_qwen": types.SimpleNamespace(**q), "MODEL_LIMITS": limits["MODEL_LIMITS"], "QWEN_MODEL": limits["QWEN_MODEL"], "TransportError": RuntimeError})
        coroutine = lambda: transport["QwenTransport"]().create(snapshot, instructions, {})
        entry = ["web/prompt_optimization_model.mjs:freezeSnapshot", "nodes/prompt_optimization/qwen.py:QwenTransport.create"]
    else:
        canvas = selected(sources.read("nodes/prompt_optimization/canvas.py"), ["INSTRUCTIONS", "REVERSE_INSTRUCTIONS", "validate_image", "polish"],
                          {"asyncio": asyncio, "hashlib": hashlib, "json": json, "re": re, "base64": base64, "io": io, "Image": Image, "local_qwen": types.SimpleNamespace(**q), "_busy": asyncio.Lock(), "_results": {}, "DeepSeekTransport": denied})
        payload = {"requestId": "capture-" + sample["id"], "model": "qwen", "mode": "reverse" if sample["entry"] == "canvas-reverse" else "polish", "source": sample.get("source", ""), "instruction": sample["instruction"]}
        if sample.get("image"):
            payload["imageDataUrl"] = "data:image/png;base64," + base64.b64encode(safe_relative(fixture_root, sample["image"]).read_bytes()).decode("ascii")
        coroutine = lambda: canvas["polish"](payload)
        entry = ["nodes/prompt_optimization/canvas.py:polish"]
    loop = asyncio.new_event_loop()
    try:
        with no_external_io(), patch.dict(sys.modules, {"comfy": comfy, "comfy.model_management": mm}):
            try:
                loop.run_until_complete(coroutine())
            except CapturedRequest as captured:
                validate_payload(captured.body)
                return captured.body, entry + ["nodes/prompt_optimization/local_qwen.py:generate", "nodes/prompt_optimization/local_qwen.py:_generate → request('/api/generate', body)"]
        raise ValueError("Capture did not reach the expected transport boundary.")
    finally:
        loop.close()


def capture_graph(sources, runtime, sample, fixture_root, work):
    models = {str(Path(w["path"]).as_posix()): w for w in runtime["weights"]}
    def model_path(category, filename):
        relative = category + "/" + filename
        if relative not in models:
            return None
        path = Path(runtime["weightRoot"]) / relative
        if not path.is_file() or path.stat().st_size != models[relative]["bytes"]:
            raise ValueError("Recorded model stack is unavailable; substitutions are prohibited.")
        return str(path)
    folders = types.SimpleNamespace(get_full_path=model_path, get_input_directory=lambda: str(work / "input"))
    node_names = ("UNETLoader", "CLIPLoaderGGUF", "TextEncodeQwenImage21", "QwenImage21Cache", "VAELoader", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage", "MiniMaxH3ImageToVideo")
    env = {"folder_paths": folders, "nodes": types.SimpleNamespace(MAX_RESOLUTION=16384, NODE_CLASS_MAPPINGS=dict.fromkeys(node_names)), "math": math, "secrets": secrets, "Path": Path, "digest_file": file_hash, "LocalExecution": object}
    refs = []
    if sample["entry"] == "local-image":
        relative = "nodes/libtv_bridge/table_local_image.py"
        selected(sources.read(relative), ["MODEL_FILES", "SETTINGS", "REQUIRED_NODES", "LocalImage"], env)
        adapter = env["LocalImage"]()
        text = sample["text"]
    else:
        relative = "nodes/libtv_bridge/table_local_video.py"
        selected(sources.read(relative), ["MODEL_FILES", "MODEL_ALTERNATIVES", "installed_model_files", "MODES", "SETTINGS", "LocalVideo"], env)
        adapter = env["LocalVideo"]()
        adapter.cache = work / "input" / "daelab" / "table-local-h3"
        adapter.cache.mkdir(parents=True, exist_ok=True)
        for index, name in enumerate(sample["references"]):
            source = safe_relative(fixture_root, name)
            target = adapter.cache / source.name
            if not target.exists():
                shutil.copyfile(source, target)
            refs.append({"kind": "image", "path": str(target), "sha256": file_hash(source)})
        compiler = selected(sources.read("nodes/libtv_bridge/table_generation.py"), ["StructuredPrompt", "compile_segments"], {})
        text = compiler["compile_segments"](sample["segments"], refs)
        adapter.validate_request(None, sample["mode"], text, sample["settings"], refs)
    with no_external_io():
        graph = adapter.build_prompt(text, sample["settings"], refs, sample["id"])
    validate_payload(graph)
    return graph, [relative + ":" + type(adapter).__name__ + ".build_prompt", "STOP before nodes/libtv_bridge/table_local_execution.py:LocalExecution.enqueue"], refs


def validate_fixed_inputs(fixtures, plan):
    if [s["id"] for s in fixtures["samples"]] != [s["id"] for s in plan["samples"]]:
        raise ValueError("Synthetic fixtures must cover the exact ten registered sample slots.")
    for sample in fixtures["samples"]:
        if sample["id"].startswith("LOCAL-IMAGE-"):
            seed = 20261013 if sample["id"] == "LOCAL-IMAGE-001" else 20261014
            if sample["entry"] != "local-image" or sample["settings"] != {"width": 1024, "height": 1024, "seed": seed}:
                raise ValueError("Image sample changed the fixed Eval parameters.")
        elif sample["id"].startswith("LOCAL-H3-"):
            count = int(sample["id"][-1]) - 1
            if (sample["entry"] != "local-video" or len(sample["references"]) != count
                    or sample["mode"] != ("text2video", "singleImage2video", "frames2video")[count]
                    or sample["settings"] != {"width": 512, "height": 288, "duration": 1.5, "turbo": False, "seed": 20261023}):
                raise ValueError("Video sample changed the fixed Eval parameters or reference count.")
        elif sample["entry"] == "table-row" and (type(sample["maxOutputTokens"]) is not int or not 32 <= sample["maxOutputTokens"] <= 1024):
            raise ValueError("Table sample exceeds its original output budget.")


def prepare(args):
    from PIL import __version__ as pillow_version
    runtime = json.loads(args.runtime.read_text("utf-8"))
    plan = json.loads((ROOT / "docs/validation/catalog/local-eval-plan.json").read_text("utf-8"))
    fixture_root = args.fixtures.resolve()
    fixture_file = fixture_root / "samples.json"
    fixtures = json.loads(fixture_file.read_text("utf-8"))
    validate_payload(fixtures)
    validate_fixed_inputs(fixtures, plan)
    output = args.output.resolve()
    if not output.is_relative_to((ROOT / ".local").resolve()) or output.exists():
        raise ValueError("Output must be a new directory below this repository's ignored .local root.")
    sources = Sources(args.baseline_root, runtime)
    media = synthetic_images(fixture_root)
    snapshots = freeze_table(sources, fixtures, args.node)
    output.mkdir(parents=True)
    records = []
    for sample in fixtures["samples"]:
        if sample["entry"] in {"canvas-polish", "canvas-reverse", "table-row"}:
            body, entry = capture_qwen(sources, sample, fixture_root, snapshots.get(sample["id"]), output)
            image_hashes = [hashlib.sha256(base64.b64decode(data, validate=True)).hexdigest() for data in body.get("images", [])]
            effective = {"model": body["model"], "systemInstruction": body["system"], "expandedText": body["prompt"],
                         "referenceOrder": [sample["image"]] if sample.get("image") else [], "preprocessedImageSha256": image_hashes,
                         "weightSha256": [w["sha256"] for w in runtime["ollama"]["blobsVerifiedByRehash"]],
                         "temperature": body["options"]["temperature"], "seed": "omitted", "contextTokens": body["options"]["num_ctx"], "maxOutputTokens": body["options"]["num_predict"], "lora": []}
            for index, data in enumerate(body.get("images", [])):
                (output / f"{sample['id']}-preprocessed-{index}.jpg").write_bytes(base64.b64decode(data, validate=True))
        else:
            body, entry, refs = capture_graph(sources, runtime, sample, fixture_root, output)
            names = [node["inputs"][key] for node in body.values() for key in ("unet_name", "clip_name", "vae_name") if key in node["inputs"]]
            if sample["entry"] == "local-image":
                names.append("mmproj-Qwen-Image-2.1-Turbo-Abliterated-Uncensored-F16.gguf")
            weights = [w["sha256"] for w in runtime["weights"] if Path(w["path"]).name in names]
            effective = {"model": next(s["model"] for s in plan["samples"] if s["id"] == sample["id"]), "systemInstruction": "", "expandedText": body["condition"]["inputs"]["prompt"],
                         "referenceOrder": sample.get("references", []), "sourceImageSha256": [r["sha256"] for r in refs],
                         "preprocessedImageSha256": [], "preprocessingStatus": "runtime-boundary-capture-required" if refs else "no-references",
                         "weightSha256": weights, "width": sample["settings"]["width"], "height": sample["settings"]["height"], "seed": sample["settings"]["seed"], "lora": []}
            if sample["entry"] == "local-image":
                effective.update(steps=body["sample"]["inputs"]["steps"], cfg=body["sample"]["inputs"]["cfg"], sampler=body["sample"]["inputs"]["sampler_name"], scheduler=body["sample"]["inputs"]["scheduler"])
            else:
                effective.update(steps=body["schedule"]["inputs"]["steps"], sampler=body["sampler"]["inputs"]["sampler_name"], scheduler=body["schedule"]["inputs"]["scheduler"], frames=body["condition"]["inputs"]["length"], fps=body["video"]["inputs"]["fps"], inputDurationSeconds=sample["settings"]["duration"], turbo=False)
        record = {"schemaVersion": 1, "sampleId": sample["id"], "captureKind": "offline-pinned-source-construction", "transportSubmitted": False, "inferenceExecuted": False,
                  "entry": entry, "inputSha256": sha256(sample), "finalRequest": body, "effective": effective,
                  "limitations": ["Scheduling, GPU admission, live node registration and actual model loads were not exercised.", "Weight hashes are the verified M0 inventory; this preparation checks file sizes only and does not rehash weights.", "H3 reference tensors must be captured inside the actual host before tokenize/vae encode; source PNG hashes are not a replacement."]}
        save_new(output / (sample["id"] + ".json"), record)
        records.append({"sampleId": sample["id"], "path": sample["id"] + ".json", "sha256": file_hash(output / (sample["id"] + ".json"))})
    # Record downstream source and exact host preprocessing locations for the later
    # execution hook, while never importing host modules that initialize the GPU.
    sources.read("nodes/libtv_bridge/table_local_execution.py")
    host_sources = {}
    host_root = Path(runtime["host"]["root"])
    for name in ("nodes.py", "comfy_extras/nodes_minimax_h3.py", "comfy/utils.py", "comfy_api/latest/_input_impl/video_types.py"):
        committed = subprocess.run(["git", "-C", str(host_root), "show", HOST + ":" + name], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=15)
        actual = file_hash(host_root / name)
        # Git's Windows checkout can add CRLF. Only that representation change is
        # allowed for commit identity; evidence retains the exact disk-byte hash.
        if committed.returncode or (host_root / name).read_bytes().replace(b"\r\n", b"\n") != committed.stdout.replace(b"\r\n", b"\n"):
            raise ValueError("Host preprocessing source differs from the pinned commit.")
        host_sources[name] = {"commit": HOST, "sha256": actual}
    originals = json.loads((ROOT / ".local/baseline/original-workflows/manifest.json").read_text("utf-8"))
    history = []
    for index, original in enumerate(originals):
        if file_hash(original["copy"]) != original["sha256"]:
            raise ValueError("Historical comparison source changed; preserve the original snapshot.")
        history.append({"id": f"historical-source-{index+1}", "sha256": original["sha256"], "role": "private historical source only; no old output/request/cache imported"})
    public_manifest = {"schemaVersion": 1, "kind": "input-preparation-only", "planSha256": sha256(plan), "samplesSha256": file_hash(fixture_file),
                       "samples": [{"id": s["id"], "inputSha256": sha256(s)} for s in fixtures["samples"]], "media": media,
                       "sourceFiles": sources.used, "hostSourceFiles": host_sources, "historicalSourceHashes": history,
                       "knownBaselineDefect": "Historical H3 expansion contains numeric camera wording. Original private sources remain unchanged. No cleanup of expanded prompt text is allowed during request comparison. These synthetic fixtures do not reproduce or claim to repair every historical defect.",
                       "preprocessing": {"qwenVision": "Exact old image_payload: EXIF transpose → RGB → thumbnail(1024,1024) → JPEG quality 90; captured bytes hashed.", "h3": "Pending actual LoadImage and MiniMaxH3ImageToVideo.execute: first frame lanczos/stretch; last frame lanczos/center-crop. Hash contiguous CPU float32 tensor shape+bytes at both tokenize/vae boundaries before inference."}}
    save_new(fixture_root / "manifest.json", public_manifest)
    save_new(output / "preparation.json", {"schemaVersion": 1, "status": "requests-prepared-inference-not-executed", "records": records, "publicManifestSha256": file_hash(fixture_root / "manifest.json"),
             "tooling": {"prepareSha256": file_hash(Path(__file__)), "comparatorSha256": file_hash(Path(__file__).with_name("request_contract.py")), "python": sys.version, "pillow": pillow_version,
                         "node": subprocess.run([args.node, "--version"], capture_output=True, text=True, check=True, timeout=10).stdout.strip()},
             "remaining": ["Capture actual H3 preprocessed tensor hashes in the controlled inference host.", "Verify model blob/weight hashes again before the paired batch; do not treat source filename as loaded-weight proof.", "Capture Studio through its implemented entrypoints, compare all effective inputs and explain every other difference.", "Implement shared GPU admission, trace sampler execution, cold/warm metrics, zero-cloud audit and blind review before 44 paired inferences."]})
    return {"output": str(output), "samples": len(records), "submitted": 0, "inferences": 0, "remainingRuntimePreprocessingSamples": ["LOCAL-H3-002", "LOCAL-H3-003"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=ROOT / ".local/baseline/runtime.json")
    parser.add_argument("--baseline-root", type=Path, default=ROOT / ".local/host-old")
    parser.add_argument("--fixtures", type=Path, default=ROOT / "tests/fixtures/local-eval")
    parser.add_argument("--output", type=Path, default=ROOT / ".local/local-eval-preparation" / str(time.time_ns()))
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args), ensure_ascii=False, indent=2))
    except Exception as error:
        # Never serialize arbitrary provider/body data or environment variables.
        print(json.dumps({"status": "blocked", "type": type(error).__name__, "message": str(error)}, ensure_ascii=False))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
