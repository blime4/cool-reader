import importlib.util
import json
import sys
import threading
import time
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch, Mock
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("worker", Path(__file__).parents[1] / "scripts/qwen-image-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        worker.cancel_idle_release()
        worker.PIPELINE = None
        worker.RESIDENT_JOBS = 0
        self.server = worker.ThreadingHTTPServer(("127.0.0.1", 0), worker.Handler)
        self.server.token = "fake-private-token-for-test-only"
        self.server.idle_seconds = 600
        self.server.max_resident_jobs = 3
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        worker.cancel_idle_release()
        worker.PIPELINE = None
        worker.RESIDENT_JOBS = 0

    def test_health_is_authenticated_and_never_loads_model(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.base + "/health")
        self.assertEqual(error.exception.code, 403)
        with patch.object(worker, "readiness", return_value=(False, "模型未下载")), patch.object(worker, "generate_image") as generate:
            request = urllib.request.Request(self.base + "/health", headers={"X-Folio-Token": self.server.token})
            response = json.load(urllib.request.urlopen(request))
            self.assertFalse(response["ready"])
            self.assertEqual(response["app"], "folio-qwen-image")
            self.assertEqual(response["idleTimeoutSeconds"], 600)
            self.assertEqual(response["maxResidentJobs"], 3)
            generate.assert_not_called()

    def test_invalid_input_and_foreign_origin_rejected(self):
        for data, headers, expected in [({"name": ""}, {}, 400), ({"name": "测试"}, {"Origin": "https://evil.test"}, 403), ({"name": "测试", "scientificName": {}}, {}, 400)]:
            request = urllib.request.Request(self.base + "/generate", data=json.dumps(data).encode(), headers={"X-Folio-Token": self.server.token, "Content-Type": "application/json", **headers})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, expected)

    def test_generation_returns_jpeg_only_when_ready_and_lock_blocks_concurrency(self):
        def request():
            return urllib.request.Request(self.base + "/generate", data=json.dumps({"name": "示例鸟", "kind": "bird"}).encode(), headers={"X-Folio-Token": self.server.token, "Content-Type": "application/json"})
        with patch.object(worker, "readiness", return_value=(True, "ready")), patch.object(worker, "generate_image", return_value=b"\xff\xd8\xff\xe0example") as generate:
            with urllib.request.urlopen(request()) as response:
                self.assertEqual(response.headers["Content-Type"], "image/jpeg")
                self.assertTrue(response.read().startswith(b"\xff\xd8\xff"))
            self.assertEqual(generate.call_args.args[0]["kind"], "bird")
            worker.LOCK.acquire()
            try:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request())
                self.assertEqual(error.exception.code, 429)
            finally:
                worker.LOCK.release()

    def test_consecutive_tasks_keep_pipeline_on_success_and_release_on_failure(self):
        cleanup_events = []
        cuda = SimpleNamespace(is_available=lambda: True, empty_cache=Mock(side_effect=lambda: cleanup_events.append("cache")))
        resident = object()
        calls = 0

        def generate(_data):
            nonlocal calls
            if calls == 0:
                self.assertIsNone(worker.PIPELINE)
                worker.PIPELINE = resident
            else:
                self.assertIs(worker.PIPELINE, resident)
            calls += 1
            return b"\xff\xd8\xff\xe0example"

        def collect():
            self.assertIsNone(sys.exception(), "cleanup must run after the failed inference traceback is dropped")
            cleanup_events.append("gc")

        def request():
            return urllib.request.Request(self.base + "/generate", data=json.dumps({"name": "示例鸟"}).encode(), headers={"X-Folio-Token": self.server.token, "Content-Type": "application/json"})

        with patch.object(worker, "readiness", return_value=(True, "ready")), patch.object(worker, "generate_image", side_effect=generate), patch.dict(sys.modules, {"torch": SimpleNamespace(cuda=cuda)}), patch("gc.collect", side_effect=collect):
            for _ in range(2):
                with urllib.request.urlopen(request()) as response:
                    self.assertTrue(response.read().startswith(b"\xff\xd8\xff"))
                self.assertTrue(worker.LOCK.acquire(timeout=1))
                worker.LOCK.release()
                self.assertIs(worker.PIPELINE, resident)
            self.assertEqual(calls, 2)
            self.assertEqual(cleanup_events, ["gc", "cache", "gc", "cache"])
            with patch.object(worker, "generate_image", side_effect=RuntimeError("simulated OOM")):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request())
                self.assertEqual(error.exception.code, 503)
            self.assertEqual(cleanup_events[-2:], ["gc", "cache"])
            self.assertTrue(worker.LOCK.acquire(timeout=1))
            worker.LOCK.release()
            self.assertIsNone(worker.PIPELINE)

    def test_idle_timeout_releases_resident_pipeline(self):
        cleanup_events = []
        cuda = SimpleNamespace(is_available=lambda: True, empty_cache=Mock(side_effect=lambda: cleanup_events.append("cache")))
        self.server.idle_seconds = 0.05

        def generate(_data):
            worker.PIPELINE = object()
            return b"\xff\xd8\xff\xe0example"

        request = urllib.request.Request(self.base + "/generate", data=json.dumps({"name": "示例鸟"}).encode(), headers={"X-Folio-Token": self.server.token, "Content-Type": "application/json"})
        with patch.object(worker, "readiness", return_value=(True, "ready")), patch.object(worker, "generate_image", side_effect=generate), patch.dict(sys.modules, {"torch": SimpleNamespace(cuda=cuda)}), patch("gc.collect", side_effect=lambda: cleanup_events.append("gc")):
            with urllib.request.urlopen(request) as response:
                self.assertTrue(response.read().startswith(b"\xff\xd8\xff"))
            self.assertIsNotNone(worker.PIPELINE)
            deadline = time.monotonic() + 1
            while worker.PIPELINE is not None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertIsNone(worker.PIPELINE)
            self.assertEqual(cleanup_events, ["gc", "cache", "gc", "cache"])

    def test_generate_image_loads_model_only_once_for_consecutive_calls(self):
        class InferenceMode:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        image = Mock()
        image.convert.return_value = image
        image.save.side_effect = lambda output, **_kwargs: output.write(b"jpeg")
        pipeline = Mock()
        pipeline.vae = SimpleNamespace(enable_tiling=Mock())
        pipeline.return_value = SimpleNamespace(images=[image])
        pipeline_class = Mock()
        pipeline_class.from_pretrained.return_value = pipeline
        torch = SimpleNamespace(
            cuda=SimpleNamespace(is_available=lambda: True),
            bfloat16="bf16",
            inference_mode=lambda: InferenceMode(),
            Generator=lambda _device: SimpleNamespace(manual_seed=lambda _seed: object()),
        )
        diffusers = SimpleNamespace(QwenImage21Pipeline=pipeline_class)

        with patch.dict(sys.modules, {"torch": torch, "diffusers": diffusers}):
            self.assertEqual(worker.generate_image({"name": "鸟", "scientificName": "", "kind": "bird"}), b"jpeg")
            self.assertEqual(worker.generate_image({"name": "树", "scientificName": "", "kind": "plant"}), b"jpeg")
        pipeline_class.from_pretrained.assert_called_once()
        self.assertEqual(pipeline.call_count, 2)
        self.assertTrue(all(call.kwargs["use_kv_cache"] is False for call in pipeline.call_args_list))

    def test_low_memory_auto_mode_releases_after_each_job(self):
        self.assertEqual(worker.automatic_resident_jobs(32 * 1024**3), 1)
        self.assertEqual(worker.automatic_resident_jobs(128 * 1024**3), 2)

        cleanup_events = []
        cuda = SimpleNamespace(is_available=lambda: True, empty_cache=Mock(side_effect=lambda: cleanup_events.append("cache")))
        self.server.max_resident_jobs = 1
        calls = 0

        def generate(_data):
            nonlocal calls
            self.assertIsNone(worker.PIPELINE)
            worker.PIPELINE = object()
            calls += 1
            return b"\xff\xd8\xff\xe0example"

        request = urllib.request.Request(self.base + "/generate", data=json.dumps({"name": "示例鸟"}).encode(), headers={"X-Folio-Token": self.server.token, "Content-Type": "application/json"})
        with patch.object(worker, "readiness", return_value=(True, "ready")), patch.object(worker, "generate_image", side_effect=generate), patch.dict(sys.modules, {"torch": SimpleNamespace(cuda=cuda)}), patch("gc.collect", side_effect=lambda: cleanup_events.append("gc")):
            for _ in range(2):
                with urllib.request.urlopen(request) as response:
                    self.assertTrue(response.read().startswith(b"\xff\xd8\xff"))
                self.assertIsNone(worker.PIPELINE)
            self.assertEqual(calls, 2)
            self.assertEqual(cleanup_events, ["gc", "cache", "gc", "cache"])


if __name__ == "__main__":
    unittest.main()
