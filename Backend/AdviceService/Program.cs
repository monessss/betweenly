using Betweenly.Shared;
using System.Text.Json.Nodes;

var app = Api.Create("advice-service", 5103);
using var store = new JsonStore("advice");
using var gateway = new InternalClient("AdviceService", Api.Env("SERVICE_CREDENTIAL"));
// Serializes generation per process: concurrent retries never duplicate model calls.
using var generation = new SemaphoreSlim(1, 1);
AdviceValidation.Warmup();
app.MapGet("/readyz", () => Results.Ok(new { status = "ready" }));
JsonObject Query(string contactId, string requestId, JsonObject input, bool includeWritingStyle = false) => new()
{
    ["requestId"] = requestId, ["contactId"] = contactId,
    ["selectedMessageIds"] = input["selectedMessageIds"]!.DeepClone(), ["selectedEventIds"] = input["selectedEventIds"]!.DeepClone(), ["selectedPreferenceIds"] = input["selectedPreferenceIds"]!.DeepClone(), ["includeApplicableHardBoundaries"] = true, ["includeWritingStyle"] = includeWritingStyle
};
async Task<JsonObject> Context(HttpContext c, string contactId, string requestId, JsonObject input, bool includeWritingStyle = false) => (await gateway.Send(c, HttpMethod.Post, "/internal/v1/context-queries", Query(contactId, requestId, input, includeWritingStyle)))!.AsObject();
async Task<JsonNode?> Style(HttpContext c)
{
    try { return await gateway.Send(c, HttpMethod.Get, "/internal/v1/users/" + Api.User(c) + "/expression-style"); }
    catch (ApiException e) when (e.Status == 404) { return null; }
}
void RemoveAdvice(JsonObject s, string id, string user)
{
    JsonStore.Rows(s).Remove("advice/" + id);
    foreach (var key in JsonStore.Rows(s).Where(p => p.Key.StartsWith("feedback/", StringComparison.Ordinal) && p.Value!["owner"]!.GetValue<string>() == user && p.Value!["value"]!["requestId"]!.GetValue<string>() == id).Select(p => p.Key).ToArray()) JsonStore.Rows(s).Remove(key);
}
async Task<JsonObject> LoadAdvice(HttpContext c, string requestId)
{
    var user = Api.User(c);
    var snapshot = await store.Read(s =>
    {
        var value = JsonStore.Get(s, "advice", requestId, user);
        return (value, refs: (JsonArray)(JsonStore.Row(s, "advice", requestId)["dependencies"] ?? value["contextUsedRefs"])!.DeepClone(), styleRefs: JsonStore.Row(s, "advice", requestId)["styleDependencies"]?.DeepClone() as JsonArray ?? new JsonArray(), epoch: JsonStore.Epoch(s, user));
    });
    var query = new JsonObject { ["selectedMessageIds"] = new JsonArray(), ["selectedEventIds"] = new JsonArray(), ["selectedPreferenceIds"] = new JsonArray() };
    foreach (var reference in snapshot.refs.Select(r => r!.GetValue<string>()))
    {
        var parts = reference.Split(':'); var field = parts[0] switch { "message" => "selectedMessageIds", "event" => "selectedEventIds", "preference" => "selectedPreferenceIds", _ => throw Api.Scope() };
        query[field]!.AsArray().Add(parts[1]);
    }
    await Context(c, snapshot.value["contactId"]!.GetValue<string>(), requestId, query);
    if (snapshot.styleRefs.Count > 0)
    {
        var styleQuery = new JsonObject { ["selectedMessageIds"] = new JsonArray(snapshot.styleRefs.Select(r => (JsonNode?)JsonValue.Create(r!.GetValue<string>().Split(':')[1])).ToArray()), ["selectedEventIds"] = new JsonArray(), ["selectedPreferenceIds"] = new JsonArray() };
        await Context(c, snapshot.value["contactId"]!.GetValue<string>(), requestId, styleQuery);
    }
    return await store.Read(s =>
    {
        if (JsonStore.Epoch(s, user) != snapshot.epoch) throw new ApiException(409, "VERSION_CONFLICT", "背景正在变更，请刷新后重试");
        return JsonStore.Get(s, "advice", requestId, user);
    });
}
app.MapGet("/api/v1/contacts/{contactId}/advice-requests", async Task<IResult> (HttpContext c, string contactId) =>
{
    await Context(c, contactId, Api.NewId(), new JsonObject { ["selectedMessageIds"] = new JsonArray(), ["selectedEventIds"] = new JsonArray(), ["selectedPreferenceIds"] = new JsonArray() });
    var records = await store.Read(s => JsonStore.Owned(s, "advice", Api.User(c)).Where(v => v["contactId"]!.GetValue<string>() == contactId).OrderByDescending(v => v["createdAt"]!.GetValue<string>(), StringComparer.Ordinal).ToArray());
    var visible = new List<JsonObject>();
    foreach (var record in records)
    {
        try { visible.Add(await LoadAdvice(c, record["requestId"]!.GetValue<string>())); }
        catch (ApiException e) when (e.Status is 404 or 422) { /* Pending/deleted source records must not remain readable through history. */ }
    }
    return Api.Page(c, visible);
});
app.MapPost("/api/v1/contacts/{contactId}/advice-requests", async Task<IResult> (HttpContext c, string contactId) =>
{
    Api.Uuid(contactId); var user = Api.User(c); var input = Rules.Input("advice", await Api.Body(c)); var key = Api.Uuid(c.Request.Headers["Idempotency-Key"].Count == 1 ? c.Request.Headers["Idempotency-Key"].ToString() : null);
    if (input["ephemeralContext"] is not null) throw Api.Business("MVP 请先保存记录后选择分析；暂不接受临时背景");
    var hash = Api.Hash(new JsonObject { ["contactId"] = contactId, ["input"] = input.DeepClone() }); var scopeKey = user + "/" + key;
    if (!await generation.WaitAsync(TimeSpan.FromSeconds(1), c.RequestAborted)) throw new ApiException(429, "RATE_LIMITED", "已有分析正在进行，请稍后重试");
    try
    {
        var reservation = await store.Write(s =>
        {
            var map = s["idempotency"]!.AsObject();
            if (map[scopeKey] is JsonObject existing)
            {
                if (existing["hash"]!.GetValue<string>() != hash) throw new ApiException(409, "IDEMPOTENCY_KEY_REUSED", "该幂等键已用于其他分析输入");
                return (JsonObject)existing.DeepClone();
            }
            var item = new JsonObject { ["hash"] = hash, ["requestId"] = Api.NewId(), ["completed"] = false, ["contactId"] = contactId }; map[scopeKey] = item; return (JsonObject)item.DeepClone();
        });
        var requestId = reservation["requestId"]!.GetValue<string>();
        if (reservation["completed"]!.GetValue<bool>())
        {
            await Context(c, contactId, requestId, input);
            return Api.Ok(c, await LoadAdvice(c, requestId), 201);
        }
        var epoch = await store.Read(s => JsonStore.Epoch(s, user));
        var style = await Style(c);
        var includeWritingStyle = (style?["learnFromMessages"]?.GetValue<bool>() ?? true) && input["userGoal"]!.GetValue<string>() != "ASSESS_AFFINITY";
        var context = await Context(c, contactId, requestId, input, includeWritingStyle);
        if (context["messages"]!.AsArray().Count(m => m?["image"] is not null) > 2)
            throw new ApiException(413, "INPUT_TOO_LARGE", "每次分析最多选择 2 张图片，请减少后重试");
        var analysisInput = new JsonObject
        {
            ["requestId"] = requestId, ["schemaVersion"] = "1.0", ["entryPoint"] = input["entryPoint"]!.DeepClone(), ["userGoal"] = input["userGoal"]!.DeepClone(),
            ["specificQuestion"] = input["specificQuestion"]?.DeepClone(), ["draftText"] = input["draftText"]?.DeepClone(), ["expressionStyle"] = style, ["context"] = context.DeepClone()
        };
        var output = await gateway.Send(c, HttpMethod.Post, "/internal/v1/analysis", analysisInput) as JsonObject ?? throw new ApiException(502, "MODEL_OUTPUT_INVALID", "分析服务响应无效");
        AdviceValidation.Validate(output, analysisInput);
        // Reject a result if its source records/style changed or were deleted during generation.
        var latest = await Context(c, contactId, requestId, input, includeWritingStyle); var latestStyle = await Style(c);
        if (Api.Hash(latest) != Api.Hash(context) || !JsonNode.DeepEquals(style, latestStyle)) throw new ApiException(409, "VERSION_CONFLICT", "分析期间背景或表达习惯发生变化，请重新分析");
        var result = (JsonObject)output.DeepClone(); result["requestId"] = requestId; result["contactId"] = contactId;
        await store.Write(s =>
        {
            if (JsonStore.Epoch(s, user) != epoch) throw new ApiException(409, "VERSION_CONFLICT", "分析期间背景已发生变化，请重新分析");
            JsonStore.Put(s, "advice", requestId, user, result);
            var dependencies = new JsonArray();
            foreach (var (field, id, prefix) in new[] { ("messages", "messageId", "message"), ("events", "eventId", "event"), ("preferenceRecords", "recordId", "preference") })
                foreach (var record in context[field]!.AsArray()) dependencies.Add(prefix + ":" + record![id]!.GetValue<string>());
            JsonStore.Row(s, "advice", requestId)["dependencies"] = dependencies;
            JsonStore.Row(s, "advice", requestId)["styleDependencies"] = new JsonArray((context["writingStyle"]?["sourceMessageIds"] as JsonArray ?? new JsonArray()).Select(id => (JsonNode?)JsonValue.Create("message:" + id!.GetValue<string>())).ToArray());
            s["idempotency"]![scopeKey]!["completed"] = true; return true;
        });
        c.Response.Headers.Location = "/api/v1/advice-requests/" + requestId; return Api.Ok(c, result, 201);
    }
    finally { generation.Release(); }
});
app.MapGet("/api/v1/advice-requests/{requestId}", async Task<IResult> (HttpContext c, string requestId) => Api.Ok(c, await LoadAdvice(c, requestId)));
app.MapDelete("/api/v1/advice-requests/{requestId}", async Task<IResult> (HttpContext c, string requestId) =>
{
    await store.Write(s => { JsonStore.Get(s, "advice", requestId, Api.User(c)); RemoveAdvice(s, requestId, Api.User(c)); JsonStore.Bump(s, Api.User(c)); return true; }); return Results.NoContent();
});
app.MapPost("/api/v1/advice-requests/{requestId}/feedback", async Task<IResult> (HttpContext c, string requestId) =>
{
    var input = Rules.Input("feedback", await Api.Body(c)); var user = Api.User(c); await LoadAdvice(c, requestId);
    var value = await store.Write(s =>
    {
        var advice = JsonStore.Get(s, "advice", requestId, user);
        if (input["selectedOptionId"] is not null && !advice["replyOptions"]!.AsArray().Any(v => v!["optionId"]!.GetValue<string>() == input["selectedOptionId"]!.GetValue<string>())) throw Api.Business("回复候选不属于该分析");
        var id = Api.NewId(); var v = Api.Stamp(input, "feedbackId", id); v["requestId"] = requestId; JsonStore.Put(s, "feedback", id, user, v); return v;
    }); return Api.Ok(c, value, 201);
});
app.MapPost("/api/v1/advice-requests/{requestId}/outcomes", async Task<IResult> (HttpContext c, string requestId) =>
{
    var input = Rules.Input("events", await Api.Body(c)); var advice = await LoadAdvice(c, requestId);
    input["relatedAdviceId"] = requestId;
    var value = await gateway.Send(c, HttpMethod.Post, "/internal/v1/contacts/" + advice["contactId"]!.GetValue<string>() + "/outcomes", input); return Api.Ok(c, value, 201);
});
app.MapPost("/internal/v1/advice-evidence-deletions", async Task<IResult> (HttpContext c) =>
{
    var input = await Api.Body(c); Rules.Keys(input, "deletionOperationId contactId deleteContact evidenceRefs"); Rules.Text(input, "deletionOperationId", 100); var contactId = Api.Uuid(Rules.Text(input, "contactId", 36)); Rules.Bool(input, "deleteContact"); var refs = Rules.Strings(input, "evidenceRefs", 10000).ToHashSet(); var user = Api.User(c);
    var count = await store.Write(s =>
    {
        JsonStore.Bump(s, user);
        var ids = JsonStore.Owned(s, "advice", user).Where(v => v["contactId"]!.GetValue<string>() == contactId && (input["deleteContact"]!.GetValue<bool>()
            || (JsonStore.Row(s, "advice", v["requestId"]!.GetValue<string>())["dependencies"] ?? v["contextUsedRefs"])!.AsArray().Concat(JsonStore.Row(s, "advice", v["requestId"]!.GetValue<string>())["styleDependencies"] as JsonArray ?? new JsonArray()).Any(r => refs.Contains(r!.GetValue<string>())))).Select(v => v["requestId"]!.GetValue<string>()).ToArray();
        foreach (var id in ids) RemoveAdvice(s, id, user); return ids.Length;
    }); return Api.Ok(c, new JsonObject { ["deletedCount"] = count });
});
app.MapDelete("/internal/v1/users/{userId}/advice-data", async Task<IResult> (HttpContext c, string userId) =>
{
    if (Api.Uuid(userId) != Api.User(c)) throw Api.Missing();
    await store.Write(s =>
    {
        JsonStore.Bump(s, userId);
        foreach (var key in JsonStore.Rows(s).Where(p => p.Value!["owner"]!.GetValue<string>() == userId).Select(p => p.Key).ToArray()) JsonStore.Rows(s).Remove(key);
        foreach (var key in s["idempotency"]!.AsObject().Select(p => p.Key).Where(k => k.StartsWith(userId + "/", StringComparison.Ordinal)).ToArray()) s["idempotency"]!.AsObject().Remove(key);
        return true;
    }); return Results.NoContent();
});
app.Run();
