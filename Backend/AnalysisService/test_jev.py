import copy
import io
import json
import socket
import unittest
import urllib.error
from unittest.mock import Mock, patch

import server
from jev import JevError, JevReviewer, QUESTIONS, Review, parse_review, validate_base_url
from test_analysis import REQUEST, OUTPUT
from validation import InvalidOutput


def response(probability=.01, **updates):
    return {"model": "jev-1.14.0", "answers": {name: {"type": "noul", "noul": updates.get(name, probability)} for name in QUESTIONS},
            "usage": {"input_tokens": 100, "output_tokens": 10}}


def review(**updates):
    return parse_review(json.dumps(response(**updates)))


class JevTests(unittest.TestCase):
    def setUp(self):
        self.client = JevReviewer("test-only-key")
        self.output = copy.deepcopy(OUTPUT)

    def test_auto_mode_requires_key_and_explicit_mode_is_validated(self):
        self.assertFalse(JevReviewer().enabled)
        self.assertTrue(self.client.enabled)
        self.assertFalse(JevReviewer("test-only-key", enabled="false").enabled)
        self.assertTrue(JevReviewer(enabled="true").enabled)
        with self.assertRaises(ValueError):
            JevReviewer(enabled="typo")

    def test_https_and_redirect_rules(self):
        for url in ("http://example.com/v1", "https://user:pass@example.com/v1", "https://example.com/v1?key=x", "https://example.com/v1#fragment"):
            with self.assertRaises(ValueError):
                validate_base_url(url)
        with self.assertRaises(ValueError):
            validate_base_url("http://example.com", True)
        validate_base_url("http://127.0.0.1:1234/v1", True)
        from jev import NoRedirect
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example"))

    def test_probabilities_and_uncertainty(self):
        self.assertEqual(review().issues, [])
        self.assertFalse(review().uncertain)
        self.assertEqual(review(boundary_violation=.8).issues, ["boundary_violation"])
        self.assertTrue(review(style_mismatch=.5).uncertain)

    def test_malformed_or_missing_probabilities_cannot_pass(self):
        for invalid in (True, -1, 1.1, "0.1", None, float("inf"), float("nan")):
            with self.assertRaises((ValueError, TypeError)):
                parse_review(json.dumps(response(unsupported_fact=invalid)))
        payload = response(); del payload["answers"]["boundary_violation"]
        with self.assertRaises(ValueError):
            parse_review(json.dumps(payload))
        payload = response(); payload["answers"]["extra"] = {"type":"noul","noul":0}
        with self.assertRaises(ValueError):
            parse_review(json.dumps(payload))
        with self.assertRaises(ValueError):
            parse_review('{"model":"jev","answers":{},"answers":{}}')

    def test_adapter_uses_official_shape_and_only_selected_context(self):
        raw = io.BytesIO(json.dumps(response()).encode())
        opener = Mock(); opener.open.return_value = raw
        with patch("jev.urllib.request.build_opener", return_value=opener):
            result = self.client.review(REQUEST, self.output)
        request = opener.open.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(request.full_url,"https://api.typesafe.ai/v1/systemone")
        self.assertEqual(set(payload),{"model","state","questions"})
        self.assertEqual(payload["state"]["context"],REQUEST["context"])
        self.assertNotIn("requestId",payload["state"])
        self.assertNotIn("createdAt",payload["state"]["candidate"])
        self.assertNotIn("engineVersion",payload["state"]["candidate"])
        self.assertEqual(result.model,"jev-1.14.0")

    def test_adapter_errors_are_bounded_and_do_not_echo_credentials(self):
        for error, code in ((urllib.error.HTTPError("https://api.typesafe.ai",401,"sensitive provider text",{},None),"JEV_UNAVAILABLE"),
                            (urllib.error.HTTPError("https://api.typesafe.ai",429,"quota",{},None),"RATE_LIMITED"),
                            (urllib.error.HTTPError("https://api.typesafe.ai",400,"private request",{},None),"JEV_REQUEST_INVALID"),
                            (socket.timeout(),"JEV_TIMEOUT"), (urllib.error.URLError("sensitive provider text"),"JEV_UNAVAILABLE")):
            opener=Mock(); opener.open.side_effect=error
            with patch("jev.urllib.request.build_opener",return_value=opener), self.assertRaises(JevError) as raised:
                self.client.review(REQUEST,self.output)
            self.assertEqual(raised.exception.code,code)
            self.assertNotIn("sensitive",str(raised.exception))
            self.assertNotIn("test-only-key",str(raised.exception))

    def test_invalid_adapter_response_is_not_accepted(self):
        for body in (b"not-json", b"x"*64001, json.dumps(response(unsupported_fact=True)).encode()):
            opener=Mock(); opener.open.return_value=io.BytesIO(body)
            with patch("jev.urllib.request.build_opener",return_value=opener), self.assertRaises(JevError) as raised:
                self.client.review(REQUEST,self.output)
            self.assertEqual(raised.exception.code,"JEV_OUTPUT_INVALID")

    def test_missing_key_never_makes_network_call(self):
        with patch("jev.urllib.request.build_opener") as opener, self.assertRaises(JevError):
            JevReviewer(enabled="true").review(REQUEST,self.output)
        opener.assert_not_called()


class DualPipelineTests(unittest.TestCase):
    def setUp(self):
        server.cache.clear()
        self.reviewer=Mock(enabled=True)
        self.reviewer.review.return_value=review()
        self.setting=patch.object(server,"reviewer",self.reviewer)
        self.setting.start(); self.addCleanup(self.setting.stop)

    def test_pass_and_idempotent_retry_use_both_models_only_once(self):
        with patch.object(server,"model_call",return_value=copy.deepcopy(OUTPUT)) as deepseek:
            result=server.analyze(REQUEST,"dual-user")
            server.analyze(REQUEST,"dual-user")
        self.assertEqual(deepseek.call_count,1)
        self.assertEqual(self.reviewer.review.call_count,1)
        self.assertIn("jev:jev-1.14.0",result["engineVersion"])

    def test_flagged_candidate_is_revised_once_and_rechecked(self):
        self.reviewer.review.side_effect=[review(unsupported_fact=.95),review()]
        with patch.object(server,"model_call",side_effect=[copy.deepcopy(OUTPUT),copy.deepcopy(OUTPUT)]) as deepseek:
            server.generate(REQUEST)
        self.assertEqual(deepseek.call_count,2)
        self.assertEqual(deepseek.call_args.kwargs["feedback"]["reviewSignals"],["unsupported_fact"])
        self.assertEqual(self.reviewer.review.call_count,2)

    def test_persistently_flagged_result_is_never_returned_as_success(self):
        self.reviewer.review.return_value=review(boundary_violation=.98)
        with patch.object(server,"model_call",return_value=copy.deepcopy(OUTPUT)) as deepseek, self.assertRaises(server.Failure) as raised:
            server.analyze(REQUEST,"dual-user")
        self.assertEqual(raised.exception.code,"MODEL_REVIEW_FAILED")
        self.assertEqual(deepseek.call_count,2)
        self.assertIsNone(server.cache[("dual-user",REQUEST["requestId"])]["output"])

    def test_schema_retry_and_repair_share_one_generation_budget(self):
        self.reviewer.review.return_value=review(boundary_violation=.98)
        with patch.object(server,"model_call",side_effect=[InvalidOutput(),copy.deepcopy(OUTPUT)]) as deepseek, self.assertRaises(server.Failure):
            server.generate(REQUEST)
        self.assertEqual(deepseek.call_count,2)

    def test_uncertain_review_is_visible_and_not_labeled_as_fact(self):
        self.reviewer.review.return_value=review(missing_context=.5)
        with patch.object(server,"model_call",return_value=copy.deepcopy(OUTPUT)):
            result=server.generate(REQUEST)
        self.assertEqual(result["status"],"NEEDS_CONTEXT")
        self.assertIn("Jev",result["uncertainties"][-1])
        self.assertEqual(result["observations"],[])

    def test_review_outage_does_not_silently_fall_back(self):
        self.reviewer.review.side_effect=JevError(503,"JEV_UNAVAILABLE","Jev 暂不可用")
        with patch.object(server,"model_call",return_value=copy.deepcopy(OUTPUT)), self.assertRaises(server.Failure) as raised:
            server.analyze(REQUEST,"dual-user")
        self.assertEqual(raised.exception.code,"JEV_UNAVAILABLE")

    def test_total_deadline_prevents_additional_calls(self):
        with patch.object(server.time,"monotonic",side_effect=[0,61]), patch.object(server,"model_call") as deepseek, self.assertRaises(server.Failure) as raised:
            server.generate(REQUEST)
        self.assertEqual(raised.exception.code,"MODEL_TIMEOUT")
        deepseek.assert_not_called()


if __name__ == "__main__":
    unittest.main()
