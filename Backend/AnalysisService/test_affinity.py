import copy
import unittest

from test_analysis import REQUEST, OUTPUT
from validation import InvalidOutput, validate, validate_status, validate_affinity

MESSAGE = "15c85a6a-c639-45a1-9c41-bdcde743ba79"
REF = "message:" + MESSAGE


def fixtures():
    value=copy.deepcopy(REQUEST)
    value["userGoal"]="ASSESS_AFFINITY"
    value["context"]["messages"]=[{"messageId":MESSAGE,"contactId":value["context"]["contact"]["contactId"],"sender":"OTHER","text":"周末一起去看展吧？","sourceType":"COUNTERPART_EXPLICIT"}]
    output=copy.deepcopy(OUTPUT)
    output.update(status="OK",contextUsedRefs=[REF],clarifyingQuestions=[],recommendation={"actionType":"NO_ACTION","title":"好感度评估","reason":"对方主动提出了具体邀约。","evidenceRefs":[REF],"actionTags":[],"appliesWhen":None,"alternatives":[]},affinityAssessment={"score":68,"confidence":"MEDIUM","summary":"当前互动较积极，仍需观察是否持续。","evidence":[{"signal":"POSITIVE","description":"对方主动提出具体活动。","evidenceRefs":[REF]}],"uncertainties":["单次邀请也可能出于普通友谊。"]})
    return value,output


def check(value, output):
    validate(output);validate_status(output);validate_affinity(output,value)


class AffinityTests(unittest.TestCase):
    def test_bounded_score_requires_cited_counterpart_evidence(self):
        value,output=fixtures();check(value,output)
        for score in (0,100):
            output["affinityAssessment"]["score"]=score;check(value,output)

    def test_invalid_scores_are_rejected(self):
        for score in (-1,101,68.5,True,"68",float("nan"),float("inf")):
            value,output=fixtures();output["affinityAssessment"]["score"]=score
            with self.assertRaises(InvalidOutput):check(value,output)

    def test_missing_uncertainty_or_evidence_cannot_look_complete(self):
        for field in ("evidence","uncertainties"):
            value,output=fixtures();output["affinityAssessment"][field]=[]
            with self.assertRaises(InvalidOutput):check(value,output)

    def test_unknown_or_uncited_evidence_is_rejected(self):
        for reference in ("message:unknown","event:unselected"):
            value,output=fixtures();output["affinityAssessment"]["evidence"][0]["evidenceRefs"]=[reference]
            with self.assertRaises(InvalidOutput):check(value,output)

    def test_user_own_words_cannot_establish_counterpart_affinity(self):
        value,output=fixtures();value["context"]["messages"][0]["sender"]="USER"
        with self.assertRaises(InvalidOutput):check(value,output)

    def test_insufficient_information_is_null_not_fifty_or_zero(self):
        value,output=fixtures()
        output.update(status="NEEDS_CONTEXT",recommendation=None,clarifyingQuestions=copy.deepcopy(OUTPUT["clarifyingQuestions"]))
        output["affinityAssessment"].update(score=None,confidence="LOW")
        check(value,output)
        output["affinityAssessment"]["score"]=50
        with self.assertRaises(InvalidOutput):check(value,output)

    def test_assessment_does_not_generate_contact_actions(self):
        value,output=fixtures();output["recommendation"]["actionType"]="ASK_FOLLOW_UP"
        with self.assertRaises(InvalidOutput):check(value,output)

    def test_only_requested_assessments_are_allowed(self):
        value,output=fixtures();value["userGoal"]="CONTINUE_CONVERSATION"
        with self.assertRaises(InvalidOutput):check(value,output)
        value,output=fixtures();del output["affinityAssessment"]
        with self.assertRaises(InvalidOutput):check(value,output)


if __name__ == "__main__":unittest.main()
