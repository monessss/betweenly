using System.Text.Json.Nodes;
using System.Globalization;

namespace Betweenly.Shared;

public static class AdviceValidation
{
    private static readonly JsonObject Schema = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "analysis-output.schema.json")))!.AsObject();
    public static void Warmup() => _ = Schema.Count;
    private static ApiException Invalid() => new(502, "MODEL_OUTPUT_INVALID", "模型返回未通过结构、证据或边界校验，请重试");
    // Intentionally supports the complete keyword subset used by the checked-in shared schema.
    private static void Check(JsonNode? value, JsonObject schema)
    {
        if (schema["$ref"] is not null) { Check(value, Schema["$defs"]![schema["$ref"]!.GetValue<string>().Split('/').Last()]!.AsObject()); return; }
        if (schema.ContainsKey("const") && !JsonNode.DeepEquals(schema["const"], value)) throw Invalid();
        if (schema["enum"] is JsonArray enumeration && !enumeration.Any(v => JsonNode.DeepEquals(v, value))) throw Invalid();
        var type = value switch { null => "null", JsonObject => "object", JsonArray => "array", JsonValue v when v.TryGetValue<string>(out _) => "string", JsonValue v when v.TryGetValue<bool>(out _) => "boolean", _ => "number" };
        if (schema["type"] is JsonValue single && single.GetValue<string>() != type || schema["type"] is JsonArray types && !types.Any(t => t!.GetValue<string>() == type)) throw Invalid();
        if (value is JsonObject obj)
        {
            var properties = schema["properties"] as JsonObject ?? new JsonObject();
            if (schema["required"] is JsonArray required && required.Any(n => !obj.ContainsKey(n!.GetValue<string>()))) throw Invalid();
            if (schema["additionalProperties"]?.GetValue<bool>() == false && obj.Any(p => !properties.ContainsKey(p.Key))) throw Invalid();
            foreach (var pair in obj) if (properties[pair.Key] is JsonObject prop) Check(pair.Value, prop);
        }
        if (value is JsonArray array)
        {
            if (schema["maxItems"] is not null && array.Count > schema["maxItems"]!.GetValue<int>()) throw Invalid();
            if (schema["uniqueItems"]?.GetValue<bool>() == true && array.Select(v => v?.ToJsonString()).Distinct().Count() != array.Count) throw Invalid();
            if (schema["items"] is JsonObject itemSchema) foreach (var item in array) Check(item, itemSchema);
        }
        if (value is JsonValue text && text.TryGetValue<string>(out var str))
        {
            if (schema["minLength"] is not null && (string.IsNullOrWhiteSpace(str) || str.Length < schema["minLength"]!.GetValue<int>()) || schema["maxLength"] is not null && str.Length > schema["maxLength"]!.GetValue<int>()) throw Invalid();
        }
        if (type == "number")
        {
            if (!double.TryParse(value!.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) || !double.IsFinite(number)
                || schema["minimum"] is not null && number < schema["minimum"]!.GetValue<double>()
                || schema["maximum"] is not null && number > schema["maximum"]!.GetValue<double>()) throw Invalid();
        }
    }
    public static void Validate(JsonObject result, JsonObject input)
    {
        Check(result, Schema);
        try { Rules.Date(result, "createdAt"); } catch (ApiException) { throw Invalid(); }
        var context = input["context"]!.AsObject(); var allowed = new HashSet<string>();
        foreach (var (field, id, prefix) in new[] { ("messages", "messageId", "message"), ("events", "eventId", "event"), ("preferenceRecords", "recordId", "preference") })
            foreach (var record in context[field]!.AsArray()) allowed.Add(record!["evidenceRef"]?.GetValue<string>() ?? prefix + ":" + record[id]!.GetValue<string>());
        var used = result["contextUsedRefs"]!.AsArray().Select(v => v!.GetValue<string>()).ToHashSet();
        if (!used.IsSubsetOf(allowed)) throw Invalid();
        void Refs(JsonObject obj, bool must = false)
        {
            var refs = obj["evidenceRefs"]!.AsArray().Select(v => v!.GetValue<string>()).ToArray();
            if (must && refs.Length == 0 || refs.Any(r => !used.Contains(r))) throw Invalid();
        }
        foreach (var observation in result["observations"]!.AsArray().Cast<JsonObject>())
        {
            Refs(observation, observation["kind"]!.GetValue<string>() == "FACT");
            if (observation["kind"]!.GetValue<string>() == "INFERENCE" && result["uncertainties"]!.AsArray().Count == 0 && !new[] { "可能", "尚不清楚", "不确定" }.Any(observation["statement"]!.GetValue<string>().Contains)) throw Invalid();
        }
        foreach (var reply in result["replyOptions"]!.AsArray().Cast<JsonObject>()) Refs(reply);
        if (result["replyOptions"]!.AsArray().Select(r => r!["optionId"]!.GetValue<string>()).Distinct().Count() != result["replyOptions"]!.AsArray().Count) throw Invalid();
        if (result["responseHandling"]!.AsArray().Select(r => r!["scenario"]!.GetValue<string>()).Distinct().Count() != result["responseHandling"]!.AsArray().Count) throw Invalid();
        var status = result["status"]!.GetValue<string>();
        if (status == "OK")
        {
            if (result["recommendation"] is not JsonObject rec || result.ContainsKey("cannotAdviseReason")) throw Invalid();
            Refs(rec); var actions = rec["alternatives"]!.AsArray().Cast<JsonObject>().Prepend(rec).ToArray();
            var boundaries = context["preferenceRecords"]!.AsArray().Where(p => p!["hardConstraint"]?.GetValue<bool>() == true).Select(p => p!["boundaryRule"]!.GetValue<string>()).ToHashSet();
            var banned = new HashSet<string>();
            if (boundaries.Contains("DO_NOT_CONTACT_AGAIN")) { banned.UnionWith(["CONTACT", "INVITE", "EXPRESS_INTEREST"]); if (result["replyOptions"]!.AsArray().Count > 0 || result["draftRevision"] is not null) throw Invalid(); }
            foreach (var (boundary, tag) in new[] { ("DO_NOT_USE_NICKNAME", "USE_NICKNAME"), ("DO_NOT_DISCUSS_TOPIC", "DISCUSS_TOPIC"), ("DO_NOT_MENTION_LOCATION", "MENTION_LOCATION"), ("DO_NOT_PUBLICLY_MENTION", "PUBLIC_MENTION"), ("NO_PHYSICAL_CONTACT", "PHYSICAL_CONTACT") }) if (boundaries.Contains(boundary)) banned.Add(tag);
            if (actions.Any(a => a["actionTags"]!.AsArray().Any(t => banned.Contains(t!.GetValue<string>())))) throw Invalid();
            if (boundaries.Contains("DO_NOT_CONTACT_AGAIN") && actions.Any(a => a["actionType"]!.GetValue<string>() is not ("NO_ACTION" or "SLOW_DOWN"))) throw Invalid();
        }
        else
        {
            if (result["recommendation"] is not null || result["replyOptions"]!.AsArray().Count > 0 || result["draftRevision"] is not null || result["responseHandling"]!.AsArray().Count > 0) throw Invalid();
            if (status == "NEEDS_CONTEXT" && (result["clarifyingQuestions"]!.AsArray().Count == 0 || result.ContainsKey("cannotAdviseReason"))) throw Invalid();
            if (status == "CANNOT_ADVISE" && result["cannotAdviseReason"] is null) throw Invalid();
        }
        if (result["draftRevision"] is not null && string.IsNullOrWhiteSpace(input["draftText"]?.GetValue<string>())) throw Invalid();
        var assessment = result["affinityAssessment"] as JsonObject;
        if (input["userGoal"]!.GetValue<string>() != "ASSESS_AFFINITY") { if (assessment is not null) throw Invalid(); return; }
        if (assessment is null || assessment["uncertainties"]!.AsArray().Count == 0) throw Invalid();
        var evidence = assessment["evidence"]!.AsArray().Cast<JsonObject>().ToArray();
        foreach (var item in evidence) Refs(item, true);
        if (assessment["score"] is null)
        {
            if (status == "OK" || assessment["confidence"]!.GetValue<string>() != "LOW") throw Invalid();
            return;
        }
        var score = double.Parse(assessment["score"]!.ToJsonString(), CultureInfo.InvariantCulture);
        if (score != Math.Truncate(score) || status != "OK" || evidence.Length == 0) throw Invalid();
        var observed = context["messages"]!.AsArray().Where(m => m!["sender"]?.GetValue<string>() == "OTHER").Select(m => "message:" + m!["messageId"]!.GetValue<string>()).ToHashSet();
        observed.UnionWith(context["events"]!.AsArray().Where(e => e!["sourceType"]?.GetValue<string>() is "COUNTERPART_EXPLICIT" or "OBSERVED_BEHAVIOR").Select(e => "event:" + e!["eventId"]!.GetValue<string>()));
        observed.UnionWith(context["preferenceRecords"]!.AsArray().Where(p => p!["subject"]?.GetValue<string>() == "COUNTERPART" && p["sourceType"]?.GetValue<string>() == "COUNTERPART_EXPLICIT").Select(p => "preference:" + p!["recordId"]!.GetValue<string>()));
        if (!evidence.SelectMany(e => e["evidenceRefs"]!.AsArray()).Any(r => observed.Contains(r!.GetValue<string>()))) throw Invalid();
        var recommendation = result["recommendation"]!.AsObject();
        if (recommendation["actionType"]!.GetValue<string>() != "NO_ACTION" || recommendation["actionTags"]!.AsArray().Count > 0 || recommendation["alternatives"]!.AsArray().Count > 0
            || result["replyOptions"]!.AsArray().Count > 0 || result["draftRevision"] is not null || result["responseHandling"]!.AsArray().Count > 0) throw Invalid();
    }
}
