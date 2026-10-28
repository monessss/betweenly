using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Betweenly.Shared;

// User-confirmed language examples, never relationship evidence or model instructions.
public static class PersonalVoice
{
    public const string Situations = "GENERAL DAILY CARE HUMOR INVITATION APOLOGY BOUNDARY";
    public const int Capacity = 10000;
    public static JsonObject Input(JsonObject value)
    {
        Rules.Keys(value, "text situation");
        var text = Rules.Text(value, "text", 500).Trim();
        Rules.Enum(value, "situation", Situations);
        if (Regex.IsMatch(text, @"(?i)(?:sk-[a-z0-9_-]{16,}|apikey_[a-z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY|bearer\s+[a-z0-9._-]{16,})"))
            throw Api.Invalid("语料中疑似包含密钥，请先移除");
        return new JsonObject { ["text"] = text, ["situation"] = value["situation"]!.DeepClone() };
    }
    public static string Fingerprint(JsonObject value) => Api.Hash(new JsonObject
    {
        ["text"] = Regex.Replace(value["text"]!.GetValue<string>().Normalize(NormalizationForm.FormKC), @"\s+", " ").Trim(),
        ["situation"] = value["situation"]!.DeepClone()
    });
    public static long Revision(JsonObject state, string user) => JsonStore.Owned(state, "voice-meta", user).SingleOrDefault()?["revision"]?.GetValue<long>() ?? 0;
    public static void Changed(JsonObject state, string user, bool destructive = false)
    {
        JsonStore.Put(state, "voice-meta", user, user, new JsonObject { ["revision"] = Revision(state, user) + 1 });
        if (destructive) JsonStore.Bump(state, user);
    }
    public static JsonObject Status(JsonObject state, string user) => new()
    {
        ["revision"] = Revision(state, user), ["privacyVersion"] = JsonStore.Epoch(state, user),
        ["sampleCount"] = JsonStore.Owned(state, "voice", user).Count(), ["capacity"] = Capacity
    };
    public static JsonObject Import(JsonObject state, string user, JsonObject input)
    {
        Rules.Keys(input, "confirmedOwnWords samples"); Rules.Bool(input, "confirmedOwnWords");
        if (!input["confirmedOwnWords"]!.GetValue<bool>()) throw Api.Business("请先确认只导入自己的表达");
        var samples = Rules.Array(input, "samples", 500);
        if (samples.Count == 0) throw Api.Invalid("请选择至少一条语料");
        // Validate the complete batch before changing any rows.
        var parsed = samples.Select(n => Input(n as JsonObject ?? throw Api.Invalid())).ToArray();
        var existing = JsonStore.Owned(state, "voice", user).ToArray();
        var seen = existing.Select(Fingerprint).ToHashSet(StringComparer.Ordinal);
        var fresh = parsed.Where(p => seen.Add(Fingerprint(p))).ToArray();
        if (existing.Length + fresh.Length > Capacity) throw Api.Business("个人语料库最多保存 10000 条，请先删除部分语料");
        foreach (var sample in fresh)
        {
            var id = Api.NewId(); JsonStore.Put(state, "voice", id, user, Api.Stamp(sample, "sampleId", id));
        }
        if (fresh.Length > 0) Changed(state, user);
        var result = Status(state, user); result["importedCount"] = fresh.Length; result["duplicateCount"] = parsed.Length - fresh.Length;
        return result;
    }
    public static string Situation(string goal) => goal switch
    {
        "PROPOSE_INVITATION" or "PREPARE_MEETING" => "INVITATION", "APOLOGIZE" or "CLARIFY_MISUNDERSTANDING" => "APOLOGY",
        "END_CONVERSATION" => "BOUNDARY", "EXPRESS_INTEREST" => "CARE", _ => "DAILY"
    };
    private static HashSet<string> Tokens(string text)
    {
        var clean = Regex.Replace(text.Normalize(NormalizationForm.FormKC).ToLowerInvariant(), @"[^\p{L}\p{N}]", "");
        return Enumerable.Range(0, Math.Max(0, clean.Length - 1)).Select(i => clean.Substring(i, 2)).ToHashSet(StringComparer.Ordinal);
    }
    public static JsonObject Select(JsonObject state, string user, string goal, string query)
    {
        var samples = JsonStore.Owned(state, "voice", user).ToArray(); var target = Tokens(query); var situation = Situation(goal);
        if (situation == "DAILY" && Regex.IsMatch(query, "难受|难过|累了|好累|不开心|安慰|关心|生病|失落|搞砸")) situation = "CARE";
        else if (situation == "DAILY" && Regex.IsMatch(query, "玩笑|逗乐|搞笑|幽默")) situation = "HUMOR";
        var ranked = samples.Select(s =>
        {
            var tokens = Tokens(s["text"]!.GetValue<string>()); var overlap = tokens.Count(t => target.Contains(t));
            var score = (s["situation"]!.GetValue<string>() == situation ? 2 : s["situation"]!.GetValue<string>() == "GENERAL" ? .5 : 0)
                + (target.Count + tokens.Count == 0 ? 0 : 4.0 * overlap / (target.Count + tokens.Count));
            return (sample: s, score);
        }).OrderByDescending(v => v.score).ThenBy(v => v.sample["sampleId"]!.GetValue<string>(), StringComparer.Ordinal);
        // Exclude unrelated situation-specific examples; GENERAL can supply a stable voice.
        var chosen = ranked.Where(v => v.sample["situation"]!.GetValue<string>() is "GENERAL" || v.sample["situation"]!.GetValue<string>() == situation || v.score >= .5)
            .Take(8).Select(v => v.sample).ToArray();
        var lengths = chosen.Select(s => s["text"]!.GetValue<string>().Length).Order().ToArray();
        return new JsonObject
        {
            ["revision"] = Revision(state, user), ["privacyVersion"] = JsonStore.Epoch(state, user), ["sampleCount"] = samples.Length,
            ["medianLength"] = lengths.Length == 0 ? 0 : lengths[lengths.Length / 2],
            ["examples"] = new JsonArray(chosen.Select(s => (JsonNode?)new JsonObject
            {
                ["sampleId"] = s["sampleId"]!.DeepClone(), ["text"] = s["text"]!.DeepClone(), ["situation"] = s["situation"]!.DeepClone()
            }).ToArray())
        };
    }
}
