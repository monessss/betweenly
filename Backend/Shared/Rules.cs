using System.Globalization;
using System.Text.Json.Nodes;

namespace Betweenly.Shared;

public static class Rules
{
    public const string Sources = "COUNTERPART_EXPLICIT USER_SELF_REPORT USER_RELAY OBSERVED_BEHAVIOR MODEL_INFERENCE";
    public const string Boundaries = "DO_NOT_CONTACT_AGAIN DO_NOT_USE_NICKNAME DO_NOT_DISCUSS_TOPIC DO_NOT_MENTION_LOCATION DO_NOT_PUBLICLY_MENTION NO_PHYSICAL_CONTACT OTHER";
    public const string Events = "MET_IN_PERSON SHARED_EXPERIENCE INVITATION_MADE INVITATION_ACCEPTED INVITATION_DECLINED NO_RESPONSE CONVERSATION_ENDED USER_ACTION OTHER";
    public const string Goals = "START_CONTACT CONTINUE_CONVERSATION EXTEND_TOPIC PROPOSE_INVITATION PREPARE_MEETING EXPRESS_INTEREST CLARIFY_MISUNDERSTANDING APOLOGIZE END_CONVERSATION DECIDE_NEXT_STEP REVIEW_INTERACTION ASSESS_AFFINITY OTHER";
    public static string Fields(string kind) => kind switch
    {
        "contacts" => "label relationshipStage connectionContext currentSituation",
        "messages" => "sender text sentAt sequenceNo sourceType isVerbatim",
        "events" => "eventType whatHappened occurredAt sourceType userReflection relatedAdviceId",
        "preference-records" => "subject category statement boundaryRule appliesWhen sourceType sourceRefs supersedesRecordId",
        "style" => "preferredLength emojiPreference preferredTones avoidPatterns examplePhrases learnFromMessages",
        "advice" => "entryPoint userGoal specificQuestion selectedMessageIds selectedEventIds selectedPreferenceIds draftText ephemeralContext",
        "feedback" => "selectedOptionId editedText flags comment",
        _ => throw new ArgumentException("Unknown contract")
    };
    public static void Keys(JsonObject value, string fields, bool required = true)
    {
        var names = fields.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (value.Any(p => !names.Contains(p.Key)) || required && names.Any(n => !value.ContainsKey(n))) throw Api.Invalid("字段缺失或包含未声明字段");
    }
    public static string Text(JsonObject o, string key, int max, bool nullable = false, int min = 1)
    {
        if (nullable && o[key] is null) return "";
        if (o[key] is not JsonValue v || !v.TryGetValue<string>(out var value) || value.Length > max || value.Length < min || min > 0 && string.IsNullOrWhiteSpace(value)) throw Api.Invalid($"{key} 格式或长度无效");
        return value;
    }
    public static void Enum(JsonObject o, string key, string allowed, bool nullable = false)
    {
        if (nullable && o[key] is null) return;
        if (!allowed.Split(' ').Contains(Text(o, key, 100))) throw Api.Invalid($"{key} 枚举无效");
    }
    public static JsonArray Array(JsonObject o, string key, int max)
    {
        if (o[key] is not JsonArray a || a.Count > max) throw Api.Invalid($"{key} 数量无效"); return a;
    }
    public static string[] Strings(JsonObject o, string key, int max, int length = 100, bool uuid = false)
    {
        var result = Array(o, key, max).Select(n => { var t = new JsonObject { ["v"] = n?.DeepClone() }; var text = Text(t, "v", length); return uuid ? Api.Uuid(text) : text; }).ToArray();
        if (result.Distinct().Count() != result.Length) throw Api.Invalid($"{key} 不得重复"); return result;
    }
    public static void Date(JsonObject o, string key)
    {
        if (o[key] is null) return;
        var s = Text(o, key, 64);
        if (!System.Text.RegularExpressions.Regex.IsMatch(s, @"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$") || !DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) throw Api.Invalid($"{key} 必须包含明确时区");
    }
    public static void Bool(JsonObject o, string key) { if (o[key] is not JsonValue v || !v.TryGetValue<bool>(out _)) throw Api.Invalid($"{key} 必须是布尔值"); }
    public static void NullableId(JsonObject o, string key) { if (o[key] is not null) Api.Uuid(Text(o, key, 36)); }
    public static JsonObject Input(string kind, JsonObject input)
    {
        if (kind == "style" && !input.ContainsKey("learnFromMessages")) input["learnFromMessages"] = true;
        Keys(input, Fields(kind));
        switch (kind)
        {
            case "contacts": Text(input, "label", 64); Enum(input, "relationshipStage", "JUST_CONNECTED ACQUAINTED ONGOING_CONTACT PLANNING_MEETING UNCLEAR"); Text(input, "connectionContext", 2000, true, 0); Text(input, "currentSituation", 2000, true, 0); break;
            case "messages":
                Enum(input, "sender", "USER OTHER UNKNOWN"); Text(input, "text", 4000); Date(input, "sentAt"); Source(input); Bool(input, "isVerbatim");
                if (input["sequenceNo"] is not null && (input["sequenceNo"] is not JsonValue seq || !seq.TryGetValue<int>(out var i) || i < 1)) throw Api.Invalid("sequenceNo 必须为正整数或 null");
                if (!input["isVerbatim"]!.GetValue<bool>() && input["sourceType"]!.GetValue<string>() == "COUNTERPART_EXPLICIT") throw Api.Business("非逐字消息应使用转述来源");
                break;
            case "events": Enum(input, "eventType", Events); Text(input, "whatHappened", 2000); Date(input, "occurredAt"); Source(input); Text(input, "userReflection", 1000, true, 0); NullableId(input, "relatedAdviceId"); break;
            case "preference-records":
                Enum(input, "subject", "USER COUNTERPART"); Enum(input, "category", "INTEREST COMMUNICATION_STYLE HUMOR BOUNDARY CURRENT_CONTEXT"); Text(input, "statement", 2000); Enum(input, "sourceType", Sources); Text(input, "appliesWhen", 1000, true, 0); NullableId(input, "supersedesRecordId"); Strings(input, "sourceRefs", 20);
                if (input["category"]!.GetValue<string>() == "BOUNDARY") Enum(input, "boundaryRule", Boundaries);
                else if (input["boundaryRule"] is not null) throw Api.Business("只有边界记录可以设置 boundaryRule");
                break;
            case "style":
                Bool(input, "learnFromMessages");
                Enum(input, "preferredLength", "SHORT MEDIUM AS_NEEDED"); Enum(input, "emojiPreference", "AVOID NEUTRAL SPARSE");
                foreach (var tone in Strings(input, "preferredTones", 3)) if (!"NEUTRAL WARM PLAYFUL DIRECT FORMAL".Split(' ').Contains(tone)) throw Api.Invalid("表达语气无效");
                Strings(input, "avoidPatterns", 20, 100); Strings(input, "examplePhrases", 10, 500); break;
            case "advice":
                Enum(input, "entryPoint", "NEW_CONNECTION BUILD_RELATIONSHIP SPECIFIC_DIFFICULTY"); Enum(input, "userGoal", Goals); Text(input, "specificQuestion", 2000, true, 0); Text(input, "draftText", 2000, true, 0);
                foreach (var (field, max) in new[] { ("selectedMessageIds", 200), ("selectedEventIds", 50), ("selectedPreferenceIds", 50) })
                { var ids = Strings(input, field, max, 36, true); input[field] = new JsonArray(ids.Order(StringComparer.Ordinal).Select(x => (JsonNode?)JsonValue.Create(x)).ToArray()); }
                if (input["ephemeralContext"] is not null) ValidateEphemeral(input["ephemeralContext"] as JsonObject ?? throw Api.Invalid());
                break;
            case "feedback":
                Text(input, "selectedOptionId", 100, true); Text(input, "editedText", 1000, true, 0); Text(input, "comment", 1000, true, 0);
                foreach (var flag in Strings(input, "flags", 8)) if (!"TOO_ROBOTIC TOO_SMOOTH NOT_ME TOO_LONG MISREAD_CONTEXT TOO_PUSHY BOUNDARY_RISK OTHER".Split(' ').Contains(flag)) throw Api.Invalid("反馈类型无效"); break;
        }
        return input;
    }
    private static void Source(JsonObject o) { Enum(o, "sourceType", "COUNTERPART_EXPLICIT USER_SELF_REPORT USER_RELAY OBSERVED_BEHAVIOR"); }
    public static JsonObject Patch(string kind, JsonObject old, JsonObject patch)
    {
        Keys(patch, Fields(kind), false);
        if (patch.Count == 0) throw Api.Invalid("更新内容为空");
        var input = new JsonObject();
        foreach (var field in Fields(kind).Split(' ')) input[field] = patch.ContainsKey(field) ? patch[field]?.DeepClone() : old[field]?.DeepClone();
        return Input(kind, input);
    }
    private static void ValidateEphemeral(JsonObject context)
    {
        Keys(context, "messages events statements"); var refs = new HashSet<string>();
        foreach (var (field, kind, max) in new[] { ("messages", "messages", 50), ("events", "events", 20), ("statements", "preference-records", 20) })
        {
            foreach (var item in Array(context, field, max))
            {
                var obj = item as JsonObject ?? throw Api.Invalid(); var reference = Text(obj, "clientRef", 32);
                if (!refs.Add(reference)) throw Api.Invalid("clientRef 在请求内不得重复");
                var copy = (JsonObject)obj.DeepClone(); copy.Remove("clientRef");
                if (kind == "messages") copy["sequenceNo"] = null;
                if (kind == "events") copy["relatedAdviceId"] = null;
                if (kind == "preference-records") { copy["sourceRefs"] = new JsonArray(); copy["supersedesRecordId"] = null; }
                Input(kind, copy);
            }
        }
    }
    public static void PreferenceState(JsonObject value)
    {
        var inference = value["sourceType"]!.GetValue<string>() == "MODEL_INFERENCE";
        value["status"] = inference ? "PENDING" : "CONFIRMED";
        value["hardConstraint"] = value["boundaryRule"]?.GetValue<string>() == "DO_NOT_CONTACT_AGAIN" || value["category"]!.GetValue<string>() == "BOUNDARY" && !inference && value["sourceType"]!.GetValue<string>() == "COUNTERPART_EXPLICIT";
    }
}
