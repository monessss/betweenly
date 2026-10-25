import copy
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import server
from credentials import CredentialStore, CredentialError, protect, validate_update
from jev import JevReviewer
from test_analysis import REQUEST, OUTPUT


class CredentialValidationTests(unittest.TestCase):
    def test_invalid_payloads_never_include_supplied_secrets_in_errors(self):
        for value in ({}, [], {"unknown": "private-value"}, {"deepseekApiKey": "short"}, {"jevApiKey": "private value"}, {"jevApiKey": "x" * 513}, {"deepseekApiKey": 42}):
            with self.assertRaises(ValueError) as error:
                validate_update(value)
            self.assertNotIn("private", str(error.exception))
        validate_update({"deepseekApiKey": "test-only-key", "jevApiKey": None})


@unittest.skipUnless(os.name == "nt", "Windows DPAPI storage")
class CredentialStorageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = CredentialStore(self.directory.name)

    def test_windows_encryption_roundtrip_and_user_binding(self):
        raw = b"fake-provider-secret"
        encrypted = protect(raw, "user-a")
        self.assertNotIn(raw, encrypted)
        self.assertEqual(protect(encrypted, "user-a", decrypt=True), raw)
        with self.assertRaises(CredentialError):
            protect(encrypted, "user-b", decrypt=True)

    def test_restart_partial_update_and_scope(self):
        self.store.update("user-a", {"deepseekApiKey": "deepseek-fixture", "jevApiKey": "jev-fixture"})
        self.assertEqual(self.store.read("user-b"), {})
        disk = self.store.path("user-a").read_bytes()
        self.assertNotIn(b"deepseek-fixture", disk)
        self.assertNotIn(b"jev-fixture", disk)
        restarted = CredentialStore(self.directory.name)
        restarted.update("user-a", {"deepseekApiKey": "replacement-fixture"})
        self.assertEqual(restarted.read("user-a"), {"deepseekApiKey": "replacement-fixture", "jevApiKey": "jev-fixture"})
        restarted.update("user-a", {"jevApiKey": None})
        self.assertNotIn("jevApiKey", restarted.read("user-a"))

    def test_damaged_storage_fails_without_returning_disk_contents(self):
        self.store.path("user-a").write_bytes(b"not-a-valid-encrypted-secret")
        with self.assertRaises(CredentialError) as error:
            self.store.read("user-a")
        self.assertNotIn("not-a-valid", str(error.exception))

    def test_simultaneous_analysis_uses_independent_credential_snapshots(self):
        for user in ("user-a", "user-b"):
            self.store.update(user, {"deepseekApiKey": user + "-deepseek", "jevApiKey": user + "-jev"})
        server.cache.clear()
        barrier = threading.Barrier(2)
        def generate(_):
            value = server.request_credentials.get()
            barrier.wait(timeout=5)
            self.assertTrue(value["reviewer"].enabled)
            return {"deepseek": value["deepseekApiKey"], "jev": value["reviewer"].api_key}
        with patch.object(server, "credential_store", self.store), patch.object(server, "reviewer", JevReviewer(enabled="false")), patch.object(server, "generate", side_effect=generate):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(server.analyze, copy.deepcopy(REQUEST), user) for user in ("user-a", "user-b")]
                results = [future.result() for future in futures]
        self.assertEqual(results, [{"deepseek": user + "-deepseek", "jev": user + "-jev"} for user in ("user-a", "user-b")])
        self.assertIsNone(server.request_credentials.get())
        server.cache.clear()

    def test_status_exposes_only_booleans_and_env_remains_fallback(self):
        self.store.update("user-a", {"deepseekApiKey": "local-fixture-key"})
        with patch.object(server, "credential_store", self.store), patch.object(server, "API_KEY", "environment-fixture"):
            self.assertEqual(server.credentials_for("user-a")["deepseekApiKey"], "local-fixture-key")
            self.assertEqual(server.credentials_for("user-b")["deepseekApiKey"], "environment-fixture")
            status = server.credential_status(self.store.read("user-a"))
            self.assertEqual(set(status), {"deepseekConfigured", "jevConfigured"})
            self.assertTrue(all(type(value) is bool for value in status.values()))


if __name__ == "__main__":
    unittest.main()
