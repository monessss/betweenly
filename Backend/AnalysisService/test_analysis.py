import copy
import unittest
import urllib.error
from unittest.mock import Mock, patch

import server
from validation import InvalidOutput, validate, validate_status

REQUEST = {
    "requestId": "6b241530-c820-4e71-ae6e-9b3a0379e995", "schemaVersion": "1.0",
    "entryPoint": "BUILD_RELATIONSHIP", "userGoal": "CONTINUE_CONVERSATION", "specificQuestion": None,
    "draftText": None, "expressionStyle": None,
    "context": {"contact": {"contactId": "a06d6674-2841-4772-af82-845c90c90ba1"}, "messages": [], "events": [], "preferenceRecords": [], "selectedPreferenceIds": [], "autoIncludedPreferenceIds": []}
}
OUTPUT = {
    "schemaVersion": "1.0", "status": "NEEDS_CONTEXT", "contextUsedRefs": [], "observations": [], "uncertainties": [],
    "recommendation": None, "replyOptions": [], "draftRevision": None, "responseHandling": [],
    "clarifyingQuestions": [{"question": "最近说了什么？", "reason": "需要原话", "fieldHint": "MESSAGE_CONTENT"}],
    "engineVersion": "test", "createdAt": "2026-10-25T00:00:00Z"
}


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        server.cache.clear()
        from jev import JevReviewer
        setting = patch.object(server, "reviewer", JevReviewer(enabled="false"))
        setting.start()
        self.addCleanup(setting.stop)

    def test_shared_schema_and_union(self):
        validate(OUTPUT)
        validate_status(OUTPUT)
        for update in ({"extra": True}, {"status": "UNKNOWN"}, {"uncertainties": ["x" * 1001]}):
            with self.assertRaises(InvalidOutput):
                validate({**OUTPUT, **update})
        with self.assertRaises(InvalidOutput):
            validate_status({**OUTPUT, "clarifyingQuestions": []})

    def test_network_permission_failure_is_actionable_and_does_not_echo_diagnostics(self):
        opener = Mock()
        opener.open.side_effect = urllib.error.URLError(PermissionError(13, "private network diagnostic"))
        with patch.object(server, "API_KEY", "test-only-key"), patch("server.urllib.request.build_opener", return_value=opener):
            with self.assertRaises(server.Failure) as error:
                server.model_call(REQUEST)
        self.assertEqual(error.exception.code, "MODEL_UNAVAILABLE")
        self.assertIn("权限", str(error.exception))
        self.assertNotIn("private", str(error.exception))

    def test_duplicate_keys_and_nonfinite_are_invalid(self):
        for raw in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}'):
            with self.assertRaises(ValueError):
                server.strict_json(raw)

    def test_input_is_bounded_and_scope_checked(self):
        server.validate_input(REQUEST)
        value = copy.deepcopy(REQUEST)
        value["context"]["messages"] = [{"messageId": "a06d6674-2841-4772-af82-845c90c90ba1", "contactId": "other"}]
        with self.assertRaises(server.Failure) as failure:
            server.validate_input(value)
        self.assertEqual(failure.exception.code, "CONTEXT_SCOPE_INVALID")

    def test_schema_version_rejected(self):
        with self.assertRaises(server.Failure) as failure:
            server.validate_input({**REQUEST, "schemaVersion": "2.0"})
        self.assertEqual(failure.exception.code, "ANALYSIS_SCHEMA_UNSUPPORTED")

    def test_idempotency_and_owner_scoping(self):
        with patch.object(server, "model_call", return_value=OUTPUT) as call:
            self.assertEqual(server.analyze(REQUEST, "user-a"), OUTPUT)
            self.assertEqual(server.analyze(REQUEST, "user-a"), OUTPUT)
            self.assertEqual(call.call_count, 1)
            server.analyze(REQUEST, "user-b")
            self.assertEqual(call.call_count, 2)
            with self.assertRaises(server.Failure) as failure:
                server.analyze({**REQUEST, "specificQuestion": "changed"}, "user-a")
            self.assertEqual(failure.exception.code, "IDEMPOTENCY_KEY_REUSED")

    def test_failed_model_output_has_finite_retry(self):
        with patch.object(server, "model_call", side_effect=InvalidOutput()) as call:
            with self.assertRaises(server.Failure) as failure:
                server.analyze(REQUEST, "user-a")
            self.assertEqual(failure.exception.code, "MODEL_OUTPUT_INVALID")
            self.assertEqual(call.call_count, 2)
        with patch.object(server, "model_call", return_value=OUTPUT):
            self.assertEqual(server.analyze(REQUEST, "user-a"), OUTPUT)

    def test_inflight_retry_never_calls_model_twice(self):
        server.cache[("user-a", REQUEST["requestId"])] = {"checksum": "different", "time": 0, "output": None, "running": True}
        with patch.object(server, "model_call") as call:
            with self.assertRaises(server.Failure):
                server.analyze(REQUEST, "user-a")
            call.assert_not_called()

    def test_expired_output_is_removed(self):
        with patch.object(server, "model_call", return_value=OUTPUT) as call:
            server.analyze(REQUEST, "user-a")
            server.cache[("user-a", REQUEST["requestId"])]["time"] -= server.CACHE_TTL + 1
            server.analyze(REQUEST, "user-a")
            self.assertEqual(call.call_count, 2)


if __name__ == "__main__":
    unittest.main()
