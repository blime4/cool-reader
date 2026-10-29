import importlib.util
import json
import sys
import threading
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
        self.server = worker.ThreadingHTTPServer(("127.0.0.1", 0), worker.Handler)
        self.server.token = "fake-private-token-for-test-only"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_health_is_authenticated_and_never_loads_model(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.base + "/health")
        self.assertEqual(error.exception.code, 403)
        with patch.object(worker, "readiness", return_value=(False, "模型未下载")), patch.object(worker, "generate_image") as generate:
            request = urllib.request.Request(self.base + "/health", headers={"X-Folio-Token": self.server.token})
            response = json.load(urllib.request.urlopen(request))
            self.assertFalse(response["ready"])
            self.assertEqual(response["app"], "folio-qwen-image")
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

    def test_consecutive_tasks_release_pipeline_collect_and_empty_cuda_on_success_and_failure(self):
        cleanup_events = []
        cuda = SimpleNamespace(is_available=lambda: True, empty_cache=Mock(side_effect=lambda: cleanup_events.append("cache")))

        def generate(_data):
            self.assertIsNone(worker.PIPELINE)
            worker.PIPELINE = object()
            return b"\xff\xd8\xff\xe0example"

        def collect():
            self.assertIsNone(worker.PIPELINE)
            cleanup_events.append("gc")

        def request():
            return urllib.request.Request(self.base + "/generate", data=json.dumps({"name": "示例鸟"}).encode(), headers={"X-Folio-Token": self.server.token, "Content-Type": "application/json"})

        with patch.object(worker, "readiness", return_value=(True, "ready")), patch.object(worker, "generate_image", side_effect=generate), patch.dict(sys.modules, {"torch": SimpleNamespace(cuda=cuda)}), patch("gc.collect", side_effect=collect):
            for _ in range(2):
                with urllib.request.urlopen(request()) as response:
                    self.assertTrue(response.read().startswith(b"\xff\xd8\xff"))
                self.assertTrue(worker.LOCK.acquire(timeout=1))
                worker.LOCK.release()
                self.assertIsNone(worker.PIPELINE)
            self.assertEqual(cleanup_events, ["gc", "cache", "gc", "cache"])
            with patch.object(worker, "generate_image", side_effect=RuntimeError("simulated OOM")):
                worker.PIPELINE = object()
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request())
                self.assertEqual(error.exception.code, 503)
            self.assertEqual(cleanup_events[-2:], ["gc", "cache"])
            self.assertTrue(worker.LOCK.acquire(timeout=1))
            worker.LOCK.release()
            self.assertIsNone(worker.PIPELINE)


if __name__ == "__main__":
    unittest.main()
