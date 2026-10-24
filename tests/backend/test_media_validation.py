"""Actual CPU decoding of temporary synthetic media; no providers or models."""
import builtins
from fractions import Fraction
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import wave
import zlib

from backend.contracts.errors import InvalidInput
from backend.integrations.comfyui.services import CoreServices
from backend.media.validation import MediaValidationUnavailable, decode_media


def png():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b"")


class MediaValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="studio-media-validation-")
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_full_png_decode_and_corrupt_image_rejection(self):
        file = self.root / "synthetic.png"
        file.write_bytes(png())
        self.assertEqual(decode_media(file, "image"), {"kind": "image", "width": 1, "height": 1, "frames": 1})
        for data in (b"not-an-image", png()[:45]):
            file.write_bytes(data)
            with self.assertRaises(InvalidInput):
                decode_media(file, "image")

    def test_all_synthetic_video_frames_decode_and_truncation_is_rejected(self):
        import av
        file = self.root / "synthetic.mp4"
        with av.open(str(file), "w") as output:
            stream = output.add_stream("mpeg4", rate=24)
            stream.width, stream.height, stream.pix_fmt = 16, 16, "yuv420p"
            for index in range(3):
                frame = av.VideoFrame(16, 16, "rgb24")
                for plane in frame.planes:
                    plane.update(bytes(plane.buffer_size))
                frame.pts, frame.time_base = index, Fraction(1, 24)
                for packet in stream.encode(frame):
                    output.mux(packet)
            for packet in stream.encode():
                output.mux(packet)
        result = decode_media(file, "video")
        self.assertEqual(sum(result["decoded_frames"].values()), 3)
        file.write_bytes(file.read_bytes()[:100])
        with self.assertRaises(InvalidInput):
            decode_media(file, "video")

    def test_audio_decodes_and_disguised_playlist_is_not_opened_as_media(self):
        file = self.root / "synthetic.wav"
        with wave.open(str(file), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(b"\x00\x00" * 1600)
        self.assertGreater(sum(decode_media(file, "audio")["decoded_frames"].values()), 0)
        file.write_bytes(file.read_bytes()[:-1000])
        with self.assertRaises(InvalidInput):
            decode_media(file, "audio")
        disguised = self.root / "playlist.mp4"
        disguised.write_text("#EXTM3U\n#EXTINF:1\nhttps://invalid.example/never-requested\n", encoding="utf-8")
        with self.assertRaises(InvalidInput):
            decode_media(disguised, "video")

    def test_optional_decoder_absence_blocks_success_but_not_core_startup(self):
        original_import = builtins.__import__
        def without_decoders(name, *args, **kwargs):
            if name == "av" or name == "PIL" or name.startswith("PIL."):
                raise ImportError("synthetic absent optional decoder")
            return original_import(name, *args, **kwargs)
        image = self.root / "synthetic.png"
        image.write_bytes(png())
        with patch("builtins.__import__", side_effect=without_decoders):
            service = CoreServices(self.root / "user", self.root / "input", self.root)
            job, created = service.jobs.create_or_get("core-still-available", provider="fake", execution_kind="local", snapshot={"text": "synthetic"})
            self.assertTrue(created)
            self.assertEqual(job["state"], "pending")
            claim = service.jobs.begin_submission(job["request_id"], expected_version=0)
            submitted = service.jobs.mark_submitted(job["request_id"], "synthetic-native-id", expected_version=claim["version"], event_id="submitted")
            fetching = service.jobs.transition(job["request_id"], "fetching", expected_version=submitted["version"], event_id="fetching")
            asset = service.assets.register_file("output", "synthetic.png", kind="image")
            receipt = service.assets.result_receipt([asset["references"][0]["reference_id"]])
            events_before = service.jobs.events(job["request_id"])
            with self.assertRaises(MediaValidationUnavailable):
                service.jobs.transition(job["request_id"], "succeeded", expected_version=fetching["version"], event_id="complete", result=receipt)
            self.assertEqual(service.jobs.get(job["request_id"]), fetching)
            self.assertEqual(service.jobs.events(job["request_id"]), events_before)
            with self.assertRaises(MediaValidationUnavailable) as caught:
                decode_media(image, "image")
            self.assertEqual(caught.exception.public()["code"], "media_validation_unavailable")
            with self.assertRaises(MediaValidationUnavailable):
                decode_media(self.root / "not-yet-existing.mp4", "video")


if __name__ == "__main__":
    unittest.main()
