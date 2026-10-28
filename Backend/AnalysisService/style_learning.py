"""Bounded voice references and targeted checks for generated reply text only."""
import re


PROFILE_KEYS = {"contactId", "sampleCount", "verbatimSampleCount", "medianLength", "questionRate", "emojiObserved", "patterns", "examples", "sourceMessageIds"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
CANNED = [r"听起来(?:你|这|今天|最近)", r"我(?:能|完全)理解(?:你|你的感受)", r"你的感受是完全合理的", r"给你一个大大的拥抱", r"我会一直陪着你", r"无论发生什么我都在", r"随时都可以找我倾诉", r"如果你愿意的话"]


def validate_profile(profile, contact_id):
    if not isinstance(profile, dict) or set(profile) != PROFILE_KEYS or profile["contactId"] != contact_id:
        raise ValueError("writing style scope")
    for key, maximum in (("sampleCount",80),("verbatimSampleCount",80),("medianLength",160),("questionRate",100)):
        if type(profile[key]) is not int or not 0 <= profile[key] <= maximum:
            raise ValueError("writing style statistic")
    if type(profile["emojiObserved"]) is not bool or profile["verbatimSampleCount"] > profile["sampleCount"]:
        raise ValueError("writing style metadata")
    for key, limit in (("patterns",8),("examples",12)):
        if not isinstance(profile[key],list) or len(profile[key]) > limit or any(not isinstance(s,str) or not s.strip() or len(s.encode("utf-16-le"))//2 > 160 for s in profile[key]):
            raise ValueError("writing style text")
    sources = profile["sourceMessageIds"]
    if not isinstance(sources,list) or len(sources) != profile["sampleCount"] or any(not isinstance(s,str) or not UUID.fullmatch(s) for s in sources) or len(sources) != len(set(sources)):
        raise ValueError("writing style sources")


def validate_personal_voice(profile):
    keys = {"revision", "privacyVersion", "sampleCount", "medianLength", "examples"}
    if not isinstance(profile, dict) or set(profile) != keys:
        raise ValueError("personal voice structure")
    for key, maximum in (("revision", 2**53), ("privacyVersion", 2**53), ("sampleCount", 10000), ("medianLength", 500)):
        if type(profile[key]) is not int or not 0 <= profile[key] <= maximum:
            raise ValueError("personal voice statistic")
    examples = profile["examples"]
    if not isinstance(examples, list) or len(examples) > min(8, profile["sampleCount"]):
        raise ValueError("personal voice size")
    ids = set()
    for sample in examples:
        if not isinstance(sample, dict) or set(sample) != {"sampleId", "text", "situation"}:
            raise ValueError("personal voice sample")
        if not isinstance(sample["sampleId"], str) or not UUID.fullmatch(sample["sampleId"]) or sample["sampleId"] in ids:
            raise ValueError("personal voice id")
        ids.add(sample["sampleId"])
        if not isinstance(sample["text"], str) or not sample["text"].strip() or len(sample["text"].encode("utf-16-le")) // 2 > 500:
            raise ValueError("personal voice text")
        if sample["situation"] not in {"GENERAL", "DAILY", "CARE", "HUMOR", "INVITATION", "APOLOGY", "BOUNDARY"}:
            raise ValueError("personal voice situation")
    lengths = sorted(len(s["text"].encode("utf-16-le")) // 2 for s in examples)
    if profile["medianLength"] != (lengths[len(lengths)//2] if lengths else 0):
        raise ValueError("personal voice median")


def style_issues(value, result):
    replies = [item["text"] for item in result.get("replyOptions",[])]
    if result.get("draftRevision"):
        replies.append(result["draftRevision"]["text"])
    if not replies:
        return []
    manual = value.get("expressionStyle") or {}
    learned = value["context"].get("writingStyle") or {}
    personal = value["context"].get("personalVoice") or {}
    examples = manual.get("examplePhrases",[]) + learned.get("examples",[]) + [s["text"] for s in personal.get("examples", [])]
    issues=[]
    if any(re.match(r"^\s*(?:你可以这样回复|可以回复|建议回复|回复[:：])",reply) for reply in replies):
        issues.append("REPLY_CONTAINS_ASSISTANT_PREFACE")
    if any(re.search(pattern,reply) and not any(re.search(pattern,example) for example in examples) for reply in replies for pattern in CANNED):
        issues.append("CANNED_SUPPORT_LANGUAGE")
    if any(pattern and pattern in reply for pattern in manual.get("avoidPatterns",[]) for reply in replies):
        issues.append("EXPLICIT_AVOID_PATTERN")
    if manual.get("preferredLength") == "SHORT":
        maximum = 48
    else:
        # Current-contact voice takes priority over the generic personal library.
        median = learned.get("medianLength") if learned.get("sampleCount", 0) >= 5 else personal.get("medianLength") if len(personal.get("examples", [])) >= 5 else None
        maximum = max(40, median*3) if manual.get("preferredLength") != "MEDIUM" and median is not None and median <= 20 else None
    if maximum and any(len(reply) > maximum for reply in replies):
        issues.append("TOO_LONG_FOR_USER_VOICE")
    return issues
