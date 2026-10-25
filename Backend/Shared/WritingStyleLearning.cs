using System.Text.Json.Nodes;
using System.Text;
using System.Text.RegularExpressions;

namespace Betweenly.Shared;

public static class WritingStyleLearning
{
    private static readonly Regex Excluded = new(@"https?://|www\.|[\w.+-]+@[\w.-]+\.\w+|\d{5,}|(?:sk-|apikey_)[A-Za-z0-9_-]{12,}|验证码|密码|口令|password|api.?key|```|(?:system|developer|assistant)\s*:|(?:^|\n)\s*>|聊天记录|转发记录|忽略.*指令|ignore.*instructions", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    public static JsonObject Build(IEnumerable<JsonObject> messages, string contactId)
    {
        var rows = messages.Where(m => m["contactId"]?.GetValue<string>() == contactId && m["sender"]?.GetValue<string>() == "USER")
            .OrderByDescending(m => m["sentAt"]?.GetValue<string>() ?? m["createdAt"]?.GetValue<string>(), StringComparer.Ordinal)
            .ThenByDescending(m => m["messageId"]!.GetValue<string>(), StringComparer.Ordinal)
            .Where(m => Usable(m["text"]?.GetValue<string>() ?? "")).Take(80).ToArray();
        var texts = rows.Select(m => m["text"]!.GetValue<string>().Trim()).ToArray();
        var lengths = texts.Select(t => t.Length).Order().ToArray();
        var median = lengths.Length == 0 ? 0 : lengths[lengths.Length / 2];
        var questions = texts.Count(t => t.Contains('?') || t.Contains('？'));
        var noFullStop = texts.Count(t => !"。.!！?？…".Contains(t[^1]));
        var patterns = new JsonArray();
        if (texts.Length >= 3)
        {
            patterns.Add(median <= 15 ? "倾向短句，不扩写成完整小作文" : median <= 35 ? "句子长度适中，少做额外解释" : "可以完整表达，但不凑字数");
            if (noFullStop >= texts.Length * .7) patterns.Add("多数发言不以句号结尾，避免刻意书面化");
            if (questions <= texts.Length * .2) patterns.Add("很少连续追问，不必每条回复都以问句收尾");
            foreach (var phrase in new[] { "哈哈", "好嘞", "行啊", "笑死", "确实", "没事", "咋", "呗" })
                if (texts.Count(t => t.Contains(phrase, StringComparison.Ordinal)) >= Math.Max(2, texts.Length * .1)) patterns.Add("历史中会使用“" + phrase + "”，只在语境合适时参考，不要每条硬加");
        }
        return new JsonObject
        {
            ["contactId"] = contactId, ["sampleCount"] = rows.Length, ["verbatimSampleCount"] = rows.Count(m => m["isVerbatim"]?.GetValue<bool>() == true),
            ["medianLength"] = median, ["questionRate"] = texts.Length == 0 ? 0 : (int)Math.Round(100.0 * questions / texts.Length),
            ["emojiObserved"] = texts.Any(t => t.EnumerateRunes().Any(r => r.Value is >= 0x1f000 and <= 0x1faff or >= 0x2600 and <= 0x27bf)),
            ["patterns"] = new JsonArray(patterns.Take(8).Select(p => p!.DeepClone()).ToArray()),
            ["examples"] = new JsonArray(texts.Distinct(StringComparer.Ordinal).Take(12).Select(t => (JsonNode?)JsonValue.Create(t)).ToArray()),
            ["sourceMessageIds"] = new JsonArray(rows.Select(m => m["messageId"]!.DeepClone()).ToArray())
        };
    }
    private static bool Usable(string text)
    {
        text = text.Trim();
        return text.Length is >= 1 and <= 160 && text.Count(c => c == '\n') <= 2 && !Excluded.IsMatch(text)
            && !Regex.IsMatch(text, @"^\[[^\]]+\]$") && text.Any(char.IsLetter);
    }
}
