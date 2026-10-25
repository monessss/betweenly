using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using Betweenly.Shared;

internal sealed class WeChatImports : IDisposable
{
    private sealed record Preview(string User, string Contact, JsonObject Value, DateTimeOffset Expires);
    private readonly ConcurrentDictionary<string, Preview> previews = new();
    private readonly Timer cleanup;
    private readonly SemaphoreSlim captureGate = new(1, 1);
    public WeChatImports() => cleanup = new Timer(_ => Expire(), null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10));
    private void Expire() { foreach (var item in previews) if (item.Value.Expires <= DateTimeOffset.UtcNow) previews.TryRemove(item.Key, out _); }
    public async Task<JsonObject> Status(CancellationToken cancellationToken) => await Run("status", null, cancellationToken);
    public async Task<JsonObject> PreviewAsync(HttpContext c, string contactId, JsonObject input, JsonStore store)
    {
        Rules.Keys(input, "count");
        if (input["count"] is not JsonValue valueCount || !valueCount.TryGetValue<int>(out var count) || count is < 1 or > 100) throw Api.Invalid("读取条数应为 1 至 100");
        var user = Api.User(c);
        await store.Read(s => JsonStore.Get(s, "contacts", contactId, user));
        Expire();
        if (previews.Count >= 32 || previews.Values.Count(p => p.User == user) >= 8) throw new ApiException(429, "RATE_LIMITED", "导入预览过多，请稍后重试");
        if (!await captureGate.WaitAsync(0, c.RequestAborted)) throw new ApiException(429, "RATE_LIMITED", "本地助手正在读取微信，请稍后重试");
        JsonObject capture;
        try { capture = await Run("capture", count.ToString(), c.RequestAborted); }
        finally { captureGate.Release(); }
        Rules.Keys(capture, "conversationTitle wechatVersion capturedAt messages warnings");
        Rules.Text(capture, "conversationTitle", 500, false, 0); Rules.Text(capture, "wechatVersion", 64, true); Rules.Date(capture, "capturedAt"); Rules.Strings(capture, "warnings", 10, 1000);
        var messages = Rules.Array(capture, "messages", count); if (messages.Count == 0) throw new ApiException(422, "WECHAT_NO_MESSAGES", "未读取到文字消息");
        var ids = new HashSet<string>();
        foreach (var message in messages)
        {
            var value = message as JsonObject ?? throw Api.Invalid(); Rules.Keys(value, "clientId sender text sentAt sourceType isVerbatim");
            if (!ids.Add(Api.Uuid(Rules.Text(value, "clientId", 36)))) throw Api.Invalid("助手消息标识重复");
            Rules.Enum(value, "sender", "USER OTHER UNKNOWN"); Rules.Text(value, "text", 4000); Rules.Date(value, "sentAt");
            value["sourceType"] = "USER_RELAY"; value["isVerbatim"] = false;
        }
        var existing = await store.Read(s => { JsonStore.Get(s, "contacts", contactId, user); return JsonStore.Owned(s, "messages", user).Where(m => m["contactId"]!.GetValue<string>() == contactId).ToArray(); });
        foreach (var message in messages.Cast<JsonObject>()) message["possibleDuplicate"] = existing.Any(m => m["sender"]!.GetValue<string>() == message["sender"]!.GetValue<string>() && Normalize(m["text"]!.GetValue<string>()) == Normalize(message["text"]!.GetValue<string>()));
        var id = Api.NewId(); capture["previewId"] = id; capture["contactId"] = contactId; capture["expiresAt"] = DateTimeOffset.UtcNow.AddMinutes(5).ToString("O");
        await store.Read(s => { JsonStore.Get(s, "contacts", contactId, user); previews[id] = new Preview(user, contactId, (JsonObject)capture.DeepClone(), DateTimeOffset.UtcNow.AddMinutes(5)); return true; });
        return capture;
    }
    public async Task<JsonObject> Commit(HttpContext c, string contactId, JsonObject input, JsonStore store)
    {
        Rules.Keys(input, "previewId conversationConfirmed messages");
        var previewId = Api.Uuid(Rules.Text(input, "previewId", 36)); Rules.Bool(input, "conversationConfirmed");
        if (!input["conversationConfirmed"]!.GetValue<bool>()) throw Api.Business("请确认微信会话对应当前联系人");
        var selections = Rules.Array(input, "messages", 100); if (selections.Count == 0) throw Api.Invalid("至少选择一条消息");
        var user = Api.User(c); var hash = Api.Hash(input); var selectedIds = new HashSet<string>();
        foreach (var selected in selections)
        {
            var value = selected as JsonObject ?? throw Api.Invalid(); Rules.Keys(value, "clientId sender text");
            if (!selectedIds.Add(Api.Uuid(Rules.Text(value, "clientId", 36)))) throw Api.Invalid("消息不得重复选择");
            Rules.Enum(value, "sender", "USER OTHER UNKNOWN"); Rules.Text(value, "text", 4000);
        }
        // Exact retries remain replayable after the short-lived plaintext preview expires.
        return await store.Write(s =>
        {
            JsonStore.Get(s, "contacts", contactId, user);
            var row = JsonStore.Rows(s)["wechat-imports/" + previewId];
            if (row is not null)
            {
                var old = JsonStore.Get(s, "wechat-imports", previewId, user);
                if (old["contactId"]!.GetValue<string>() != contactId) throw Api.Missing();
                if (old["requestHash"]!.GetValue<string>() != hash) throw new ApiException(409, "IDEMPOTENCY_KEY_REUSED", "该预览已使用其他内容导入，请重新读取");
                return Replay(old, selections.Count);
            }
            Expire();
            if (!previews.TryGetValue(previewId, out var preview) || preview.User != user || preview.Contact != contactId) throw new ApiException(404, "WECHAT_PREVIEW_EXPIRED", "导入预览已过期，请重新读取微信");
            var original = preview.Value["messages"]!.AsArray().Cast<JsonObject>().ToDictionary(m => m["clientId"]!.GetValue<string>());
            var accepted = new JsonArray();
            foreach (var selected in selections.Cast<JsonObject>())
            {
                var id = selected["clientId"]!.GetValue<string>(); if (!original.TryGetValue(id, out var source)) throw Api.Scope();
                accepted.Add(new JsonObject { ["sender"] = selected["sender"]!.DeepClone(), ["text"] = selected["text"]!.DeepClone(), ["sentAt"] = source["sentAt"]?.DeepClone(), ["sequenceNo"] = null, ["sourceType"] = "USER_RELAY", ["isVerbatim"] = false });
            }
            // Identical text without reliable timestamps is only a possible duplicate.
            // A fresh preview is a new explicit selection; never silently discard repeated real messages.
            var messageIds = new JsonArray();
            foreach (var message in accepted.Cast<JsonObject>())
            {
                Rules.Input("messages", message); var id = Api.NewId(); var value = Api.Stamp(message, "messageId", id, contactId);
                JsonStore.Put(s, "messages", id, user, value); messageIds.Add(id);
            }
            var result = new JsonObject { ["importId"] = previewId, ["contactId"] = contactId, ["importedCount"] = accepted.Count, ["skippedCount"] = 0, ["messageIds"] = messageIds, ["createdAt"] = Api.Now() };
            var receipt = (JsonObject)result.DeepClone(); receipt["requestHash"] = hash;
            JsonStore.Put(s, "wechat-imports", previewId, user, receipt); return result;
        });
    }
    private static string Normalize(string value) => string.Concat(value.Where(c => !char.IsWhiteSpace(c)));
    private static JsonObject Replay(JsonObject receipt, int selectedCount) => new()
    {
        ["importId"] = receipt["importId"]!.DeepClone(), ["contactId"] = receipt["contactId"]!.DeepClone(), ["importedCount"] = 0, ["skippedCount"] = selectedCount,
        ["messageIds"] = receipt["messageIds"]!.DeepClone(), ["createdAt"] = receipt["createdAt"]!.DeepClone()
    };
    private static async Task<JsonObject> Run(string command, string? count, CancellationToken requestAborted)
    {
        var path = Api.Env("WECHAT_ASSISTANT_PATH");
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) throw new ApiException(503, "WECHAT_ASSISTANT_UNAVAILABLE", "本地微信助手未启动，请用一键脚本启动 Betweenly");
        var extension = Path.GetExtension(path);
        if (extension is not (".dll" or ".mjs" or ".exe")) throw new ApiException(503, "WECHAT_ASSISTANT_UNAVAILABLE", "助手配置无效");
        var start = new ProcessStartInfo(extension == ".exe" ? Path.GetFullPath(path) : extension == ".dll" ? "dotnet" : "node") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
        if (extension != ".exe") start.ArgumentList.Add(Path.GetFullPath(path)); start.ArgumentList.Add(command); if (count is not null) start.ArgumentList.Add(count);
        // The helper has no provider credential and performs no model/network requests.
        start.Environment.Remove("DEEPSEEK_API_KEY");
        start.Environment.Remove("TYPESAFE_API_KEY");
        using var process = Process.Start(start) ?? throw new ApiException(503, "WECHAT_ASSISTANT_UNAVAILABLE", "本地微信助手无法启动");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(requestAborted); timeout.CancelAfter(TimeSpan.FromSeconds(command == "status" ? 8 : 65));
        var output = process.StandardOutput.ReadToEndAsync(timeout.Token); var errors = process.StandardError.ReadToEndAsync(timeout.Token);
        try
        {
            await process.WaitForExitAsync(timeout.Token); await Task.WhenAll(output, errors);
            if (output.Result.Length > 1024 * 1024) throw new ApiException(413, "INPUT_TOO_LARGE", "本次读取内容过多，请减少条数");
            var result = JsonNode.Parse(output.Result.Trim('\uFEFF', '\r', '\n', ' ')) as JsonObject ?? throw new ApiException(503, "WECHAT_ASSISTANT_UNAVAILABLE", "助手响应格式无效");
            if (result["error"] is JsonObject error) throw new ApiException(422, error["code"]!.GetValue<string>(), error["message"]!.GetValue<string>());
            if (process.ExitCode != 0) throw new ApiException(503, "WECHAT_ASSISTANT_UNAVAILABLE", "本地助手未完成读取");
            return result;
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(true);
            if (requestAborted.IsCancellationRequested) throw;
            throw new ApiException(504, "WECHAT_CAPTURE_TIMEOUT", "本地读取超时，请减少条数重试");
        }
        catch (System.Text.Json.JsonException) { throw new ApiException(503, "WECHAT_ASSISTANT_UNAVAILABLE", "本地助手响应格式无效"); }
    }
    public void Clear(string user, string? contactId = null) { foreach (var item in previews) if (item.Value.User == user && (contactId is null || item.Value.Contact == contactId)) previews.TryRemove(item.Key, out _); }
    public void Dispose() { cleanup.Dispose(); captureGate.Dispose(); previews.Clear(); }
}
