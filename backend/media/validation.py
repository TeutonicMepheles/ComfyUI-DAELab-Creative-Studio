"""Decode local result media before publishing success; optional imports are lazy."""
from pathlib import Path

from ..contracts.errors import ContractError, InvalidInput


class MediaValidationUnavailable(ContractError):
    code = "media_validation_unavailable"
    action = "install_media_decoder_then_verify_original_result"


def decode_media(file: Path, kind: str) -> dict:
    """Fully decode every media stream. No network URL, model or fallback is used."""
    if kind == "image":
        try:
            from PIL import Image
        except ImportError:
            raise MediaValidationUnavailable("Image verification requires Pillow; the existing result remains unconfirmed.") from None
        try:
            with Image.open(file) as image:
                image.verify()
            with Image.open(file) as image:
                count = getattr(image, "n_frames", 1)
                for index in range(count):
                    image.seek(index)
                    image.load()
                    if image.width < 1 or image.height < 1:
                        raise InvalidInput("Image result has invalid dimensions.")
                return {"kind": kind, "width": image.width, "height": image.height, "frames": count}
        except ContractError:
            raise
        except Exception:
            raise InvalidInput("Image result could not be completely decoded; success was not committed.") from None
    if kind not in {"video", "audio"}:
        raise InvalidInput("Result media kind cannot be decoded.")
    formats = {".mp4": "mov", ".mov": "mov", ".m4a": "mov", ".webm": "matroska", ".wav": "wav", ".mp3": "mp3", ".ogg": "ogg"}
    format_name = formats.get(file.suffix.lower())
    if format_name is None:
        raise InvalidInput("Result media container is not supported for verification.")
    try:
        import av
    except ImportError:
        raise MediaValidationUnavailable("Audio/video verification requires PyAV; the existing result remains unconfirmed.") from None
    try:
        if format_name == "wav":
            # FFmpeg can decode the surviving samples of a truncated RIFF file
            # without raising. Its declared container extent must also exist.
            with file.open("rb") as source:
                header = source.read(12)
                if header[:4] in {b"RIFF", b"RIFX"} and header[8:12] == b"WAVE":
                    order = "little" if header[:4] == b"RIFF" else "big"
                    extent = int.from_bytes(header[4:8], order) + 8
                    if extent < 12 or extent > source.seek(0, 2):
                        raise InvalidInput("Audio result is shorter than its declared container length.")
        # Force the expected local container, preventing playlists disguised as
        # .mp4/.webm from resolving remote media. A supplied file object provides
        # the only IO; secondary network/file protocols are not whitelisted.
        with file.open("rb") as source, av.open(source, mode="r", format=format_name,
                                                options={"protocol_whitelist": "pipe"}) as container:
            streams = [s for s in container.streams if s.type in {"video", "audio"}]
            required = [s for s in streams if s.type == kind]
            if not required:
                raise InvalidInput("Result container has no stream of the declared media kind.")
            counts = {s.index: 0 for s in streams}
            for stream in streams:
                stream.codec_context.options = {**stream.codec_context.options, "err_detect": "explode"}
            for packet in container.demux(streams):
                for frame in packet.decode():
                    if packet.stream.type == "video" and (frame.width < 1 or frame.height < 1):
                        raise InvalidInput("Video result has invalid frame dimensions.")
                    if packet.stream.type == "audio" and frame.samples < 1:
                        raise InvalidInput("Audio result has an empty decoded frame.")
                    counts[packet.stream.index] += 1
            if any(counts[s.index] == 0 for s in streams):
                raise InvalidInput("Result contains an empty or undecodable media stream.")
            if any(s.type == "video" and s.frames > 0 and counts[s.index] != s.frames for s in streams):
                raise InvalidInput("Video result does not contain all of its declared frames.")
            return {"kind": kind, "decoded_frames": counts}
    except ContractError:
        raise
    except Exception:
        raise InvalidInput("Audio/video result could not be completely decoded; success was not committed.") from None


class MediaResultValidator:
    """Compose pure catalog identity/hash verification with full media decoding."""
    verifies_media_decode = True

    def __init__(self, assets):
        self.assets = assets

    def __call__(self, receipt):
        self.assets.validate_result_receipt(receipt)
        for item in receipt["items"]:
            asset = self.assets.get(item["asset_id"])
            reference = next((r for r in asset["references"] if r["reference_id"] == item["reference_id"]), None)
            if reference is None:
                raise InvalidInput("Result reference does not belong to its declared asset.")
            file, _ = self.assets.resolve_reference(reference["root_key"], reference["relative_path"])
            decode_media(file, asset["kind"])
        # Detect source replacement during decode, before task success is written.
        self.assets.validate_result_receipt(receipt)
        return True
