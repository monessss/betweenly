import copy
import unittest
from unittest.mock import patch
import server
from jev import JevReviewer, Review, QUESTIONS
from style_learning import validate_personal_voice, style_issues
from test_analysis import REQUEST
from test_style_learning import reply_output


def voice():
    return {"revision": 2, "privacyVersion": 0, "sampleCount": 1000, "medianLength": 5,
            "examples": [{"sampleId": f"00000000-0000-4000-8000-{i:012d}", "text": "那你先歇会", "situation": "CARE"} for i in range(6)]}


class PersonalVoiceTests(unittest.TestCase):
    def setUp(self):
        self.value = copy.deepcopy(REQUEST)
        self.value["context"]["personalVoice"] = voice()

    def test_profile_is_bounded_and_strict(self):
        server.validate_input(self.value)
        for update in ({"examples": voice()["examples"] * 2}, {"sampleCount": 10001}, {"revision": True}, {"medianLength": 100}, {"unexpected": "x"}):
            with self.assertRaises(ValueError): validate_personal_voice({**voice(), **update})
        bad = voice(); bad["examples"][1]["sampleId"] = bad["examples"][0]["sampleId"]
        with self.assertRaises(ValueError): validate_personal_voice(bad)

    def test_disabled_and_assessment_modes_reject_corpus(self):
        self.value["expressionStyle"] = {"usePersonalCorpus": False}
        with self.assertRaises(server.Failure): server.validate_input(self.value)
        self.value["expressionStyle"] = None; self.value["userGoal"] = "ASSESS_AFFINITY"
        with self.assertRaises(server.Failure): server.validate_input(self.value)

    def test_personal_examples_help_length_and_manual_preferences_override(self):
        long = "这是明显太长的回复，反复解释和重复关心。" * 5
        self.assertIn("TOO_LONG_FOR_USER_VOICE", style_issues(self.value, reply_output(long)))
        self.value["expressionStyle"] = {"preferredLength": "MEDIUM"}
        self.assertNotIn("TOO_LONG_FOR_USER_VOICE", style_issues(self.value, reply_output(long)))
        self.assertEqual(style_issues(self.value, reply_output("那你先歇会")), [])

    def test_generator_and_reviewer_receive_same_selected_examples(self):
        reviewer = JevReviewer("test-only-key", enabled="true")
        with patch.object(server, "reviewer", reviewer), patch.object(server, "model_call", return_value=reply_output("那你先歇会")) as model, patch.object(reviewer, "review", return_value=Review("jev-fixture", {key: .01 for key in QUESTIONS})) as check:
            server.generate(self.value)
        self.assertEqual(model.call_args.args[0]["context"]["personalVoice"], voice())
        self.assertEqual(check.call_args.args[0]["context"]["personalVoice"], voice())

    def test_current_contact_voice_takes_priority_over_generic_short_examples(self):
        self.value["context"]["writingStyle"] = {"sampleCount": 6, "medianLength": 60, "examples": []}
        self.assertNotIn("TOO_LONG_FOR_USER_VOICE", style_issues(self.value, reply_output("这是详细解释的一部分。" * 6)))


if __name__ == '__main__': unittest.main()
