import copy
import unittest
from unittest.mock import patch

import server
from jev import JevReviewer
from style_learning import style_issues, validate_profile
from test_analysis import REQUEST, OUTPUT


def profile():
    return {"contactId":REQUEST["context"]["contact"]["contactId"],"sampleCount":6,"verbatimSampleCount":3,"medianLength":6,"questionRate":10,"emojiObserved":False,
            "patterns":["倾向短句"],"examples":["哈哈可以","那你先歇会"],"sourceMessageIds":[f"00000000-0000-4000-8000-{i:012d}" for i in range(6)]}


def reply_output(text):
    result=copy.deepcopy(OUTPUT)
    result.update(status="OK",clarifyingQuestions=[],recommendation={"actionType":"ASK_FOLLOW_UP","title":"简短回应","reason":"按当前对话回应。","evidenceRefs":[],"actionTags":["CONTACT"],"appliesWhen":None,"alternatives":[]},replyOptions=[{"optionId":"a","text":text,"style":"自然","evidenceRefs":[],"appliesWhen":None}])
    return result


class StyleLearningTests(unittest.TestCase):
    def setUp(self):
        self.value=copy.deepcopy(REQUEST);self.value["context"]["writingStyle"]=profile()

    def test_profile_is_bounded_and_tied_to_the_current_contact(self):
        server.validate_input(self.value)
        for update in ({"contactId":"other"},{"sampleCount":81},{"questionRate":True},{"examples":["a"*161]},{"sourceMessageIds":["not-a-uuid"]}):
            with self.assertRaises(ValueError):validate_profile({**profile(),**update},profile()["contactId"])

    def test_natural_short_reply_is_not_forced_to_have_question_or_empathy(self):
        for text in ("行","那你早点睡","哈哈可以","我晚点再看"):
            self.assertEqual(style_issues(self.value,reply_output(text)),[])

    def test_canned_language_and_assistant_prefaces_are_flagged(self):
        self.assertIn("CANNED_SUPPORT_LANGUAGE",style_issues(self.value,reply_output("听起来你今天真的很累，如果你愿意的话可以和我说说。")))
        self.assertIn("REPLY_CONTAINS_ASSISTANT_PREFACE",style_issues(self.value,reply_output("你可以这样回复：早点休息。")))

    def test_user_usual_phrase_is_allowed_and_manual_preferences_win(self):
        self.value["expressionStyle"]={"examplePhrases":["如果你愿意的话我们可以聊聊"],"avoidPatterns":[],"preferredLength":"AS_NEEDED"}
        self.assertNotIn("CANNED_SUPPORT_LANGUAGE",style_issues(self.value,reply_output("如果你愿意的话可以讲讲")))
        self.value["expressionStyle"]["avoidPatterns"]=["亲亲"]
        self.assertIn("EXPLICIT_AVOID_PATTERN",style_issues(self.value,reply_output("亲亲晚安")))

    def test_long_reply_is_checked_against_short_samples_but_not_medium_override(self):
        text="这是很长的一段聊天回复，不停解释该怎么说话，还要在结尾加上一段多余的安慰和没必要的追问。"*2
        self.assertIn("TOO_LONG_FOR_USER_VOICE",style_issues(self.value,reply_output(text)))
        self.value["expressionStyle"]={"preferredLength":"MEDIUM"}
        self.assertNotIn("TOO_LONG_FOR_USER_VOICE",style_issues(self.value,reply_output(text)))

    def test_analysis_reason_is_not_mistaken_for_a_sendable_message(self):
        output=copy.deepcopy(OUTPUT);output["uncertainties"]=["听起来你提供的材料还不完整。"]
        self.assertEqual(style_issues(self.value,output),[])

    def test_style_issue_rewrites_once_even_when_jev_is_off(self):
        with patch.object(server,"reviewer",JevReviewer(enabled="false")), patch.object(server,"model_call",side_effect=[reply_output("听起来你今天很累，如果你愿意的话可以聊聊。"),reply_output("那你先歇会")]) as call:
            result=server.generate(self.value)
        self.assertEqual(result["replyOptions"][0]["text"],"那你先歇会")
        self.assertEqual(call.call_count,2)
        self.assertIn("CANNED_SUPPORT_LANGUAGE",call.call_args.kwargs["feedback"]["reviewSignals"])

    def test_persistent_canned_reply_does_not_get_returned_as_success(self):
        with patch.object(server,"reviewer",JevReviewer(enabled="false")), patch.object(server,"model_call",side_effect=lambda *a,**k:reply_output("听起来你今天很累。")) as call, self.assertRaises(server.Failure) as raised:
            server.generate(self.value)
        self.assertEqual(raised.exception.code,"MODEL_STYLE_MISMATCH");self.assertEqual(call.call_count,2)


if __name__ == "__main__":unittest.main()
