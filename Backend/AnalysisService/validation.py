"""No third-party dependencies. Validates the exact shared JSON Schema subset."""
import json
import math
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "contracts" / "analysis-output.schema.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


class InvalidOutput(ValueError):
    pass


def validate(value, schema=None):
    schema = SCHEMA if schema is None else schema
    if "$ref" in schema:
        return validate(value, SCHEMA["$defs"][schema["$ref"].split("/")[-1]])
    if "const" in schema and value != schema["const"]:
        raise InvalidOutput("constant")
    if "enum" in schema and value not in schema["enum"]:
        raise InvalidOutput("enum")
    kind = ("null" if value is None else "boolean" if isinstance(value, bool) else
            "object" if isinstance(value, dict) else "array" if isinstance(value, list) else
            "string" if isinstance(value, str) else "number")
    types = schema.get("type", kind)
    if kind not in (types if isinstance(types, list) else [types]):
        raise InvalidOutput("type")
    if isinstance(value, dict):
        if any(key not in value for key in schema.get("required", [])):
            raise InvalidOutput("required")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False and value.keys() - properties.keys():
            raise InvalidOutput("additionalProperties")
        for key, item in value.items():
            if key in properties:
                validate(item, properties[key])
    elif isinstance(value, list):
        if len(value) > schema.get("maxItems", float("inf")):
            raise InvalidOutput("maxItems")
        if schema.get("uniqueItems") and len({json.dumps(v, sort_keys=True) for v in value}) != len(value):
            raise InvalidOutput("uniqueItems")
        if "items" in schema:
            for item in value:
                validate(item, schema["items"])
    elif isinstance(value, str):
        # Match .NET's UTF-16 length counting for supplementary characters.
        length = len(value.encode("utf-16-le")) // 2
        if length < schema.get("minLength", 0) or length > schema.get("maxLength", float("inf")) or schema.get("minLength", 0) and not value.strip():
            raise InvalidOutput("length")
    elif kind == "number":
        if not math.isfinite(value) or value < schema.get("minimum", -math.inf) or value > schema.get("maximum", math.inf):
            raise InvalidOutput("number range")


def validate_status(output):
    status = output["status"]
    if status == "OK":
        if output["recommendation"] is None or "cannotAdviseReason" in output:
            raise InvalidOutput("OK union")
    else:
        if output["recommendation"] is not None or output["replyOptions"] or output["draftRevision"] is not None or output["responseHandling"]:
            raise InvalidOutput("non-OK union")
        if status == "NEEDS_CONTEXT" and (not output["clarifyingQuestions"] or "cannotAdviseReason" in output):
            raise InvalidOutput("NEEDS_CONTEXT union")
        if status == "CANNOT_ADVISE" and "cannotAdviseReason" not in output:
            raise InvalidOutput("CANNOT_ADVISE union")


def validate_affinity(output, value):
    assessment = output.get("affinityAssessment")
    if value["userGoal"] != "ASSESS_AFFINITY":
        if assessment is not None:
            raise InvalidOutput("unrequested affinity assessment")
        return
    if not isinstance(assessment, dict) or not assessment["uncertainties"]:
        raise InvalidOutput("affinity assessment and uncertainty required")
    used = set(output["contextUsedRefs"])
    context = value["context"]
    allowed = {prefix + ":" + row[field] for name, field, prefix in (("messages", "messageId", "message"), ("events", "eventId", "event"), ("preferenceRecords", "recordId", "preference")) for row in context[name]}
    if not used.issubset(allowed):
        raise InvalidOutput("affinity scope")
    for item in assessment["evidence"]:
        if not item["evidenceRefs"] or not set(item["evidenceRefs"]).issubset(used):
            raise InvalidOutput("affinity evidence refs")
    score = assessment["score"]
    if score is None:
        if output["status"] == "OK" or assessment["confidence"] != "LOW":
            raise InvalidOutput("unscored affinity union")
        return
    if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or score != int(score) or not 0 <= score <= 100 or output["status"] != "OK" or not assessment["evidence"]:
        raise InvalidOutput("affinity score")
    observed = {"message:" + row["messageId"] for row in context["messages"] if row.get("sender") == "OTHER"}
    observed |= {"event:" + row["eventId"] for row in context["events"] if row.get("sourceType") in {"COUNTERPART_EXPLICIT", "OBSERVED_BEHAVIOR"}}
    observed |= {"preference:" + row["recordId"] for row in context["preferenceRecords"] if row.get("subject") == "COUNTERPART" and row.get("sourceType") == "COUNTERPART_EXPLICIT"}
    cited = {reference for item in assessment["evidence"] for reference in item["evidenceRefs"]}
    if not cited.intersection(observed):
        raise InvalidOutput("affinity requires counterpart evidence")
    recommendation = output["recommendation"]
    if recommendation["actionType"] != "NO_ACTION" or recommendation["actionTags"] or recommendation["alternatives"] or output["replyOptions"] or output["draftRevision"] is not None or output["responseHandling"]:
        raise InvalidOutput("assessment must not generate contact instructions")
