import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from processors.ai_processor import AIProcessor, Classification, LineItem


def _processor() -> AIProcessor:
    processor = AIProcessor.__new__(AIProcessor)
    processor.MAX_WORKERS = 2
    return processor


class AIProcessorTests(unittest.TestCase):
    def test_keeps_vision_results_when_text_request_fails(self):
        processor = _processor()
        processor._generate = lambda *_args: (_ for _ in ()).throw(
            RuntimeError("Gemini 503 unavailable")
        )
        processor._classify_images = lambda *_args, **_kwargs: Classification(
            line_items=[LineItem(item_name="Pump", description="Pump", qty="1")]
        )

        result = processor.classify("text document", image_paths=["scan.png"])

        self.assertEqual(result["line_items"][0]["description"], "Pump")
        self.assertTrue(any("Text classification failed" in item for item in result["warnings"]))

    def test_keeps_text_results_when_vision_request_fails(self):
        processor = _processor()
        processor._generate = lambda *_args: Classification(
            line_items=[LineItem(item_name="Valve", description="Valve", qty="2")]
        )
        processor._classify_images = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("Gemini 503 unavailable")
        )

        result = processor.classify("text document", image_paths=["scan.png"])

        self.assertEqual(result["line_items"][0]["description"], "Valve")
        self.assertTrue(any("Images classification failed" in item for item in result["warnings"]))

    def test_raises_when_every_classification_task_fails(self):
        processor = _processor()
        processor._generate = lambda *_args: (_ for _ in ()).throw(
            RuntimeError("Gemini 503 unavailable")
        )
        processor._classify_images = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("Gemini 503 unavailable")
        )

        with self.assertRaisesRegex(RuntimeError, "503 unavailable"):
            processor.classify("text document", image_paths=["scan.png"])

    def test_retries_transient_provider_failures_before_succeeding(self):
        processor = _processor()
        processor.provider = "gemini"
        processor.models = ["test-model"]
        processor._bad_models = set()
        processor._bad_lock = threading.Lock()
        processor._model_failures = {}
        processor.use_cache = False
        processor._cache_path = lambda *_args: Path("unused-cache.json")

        class FakeClient:
            calls = 0

            def generate_json(self, *_args, **_kwargs):
                self.calls += 1
                if self.calls == 1:
                    raise RuntimeError("503 temporarily unavailable")
                return Classification().model_dump_json()

        processor.client = FakeClient()
        with patch("processors.ai_processor.time.sleep"):
            result = processor._generate("text", "seed")

        self.assertIsInstance(result, Classification)
        self.assertEqual(processor.client.calls, 2)


if __name__ == "__main__":
    unittest.main()
