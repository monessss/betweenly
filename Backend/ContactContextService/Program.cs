using Betweenly.Shared;
using System.Text.Json.Nodes;

var app = Api.Create("contact-context-service", 5102);
using var store = new JsonStore("contact-context");
using var gateway = new InternalClient("ContactContextService", Api.Env("SERVICE_CREDENTIAL"));
using var mutations = new SemaphoreSlim(1, 1);
using var wechatImports = new WeChatImports();
app.MapGet("/readyz", () => Results.Ok(new { status = "ready" }));
app.MapGet("/api/v1/contacts/{contactId}/writing-style", async Task<IResult> (HttpContext c, string contactId) => Api.Ok(c, await store.Read(s =>
{
    Contact(s, contactId, Api.User(c));
    return WritingStyleLearning.Build(JsonStore.Owned(s, "messages", Api.User(c)), contactId);
})));
app.MapPost("/api/v1/contacts/{contactId}/text-imports", async Task<IResult> (HttpContext c, string contactId) =>
{
    var input = await Api.Body(c); return Api.Ok(c, await Mutate(() => TextImports.Commit(c, contactId, input, store)), 201);
});
app.MapGet("/api/v1/wechat-import/status", async Task<IResult> (HttpContext c) => Api.Ok(c, await wechatImports.Status(c.RequestAborted)));
app.MapPost("/api/v1/contacts/{contactId}/wechat-imports/preview", async Task<IResult> (HttpContext c, string contactId) => Api.Ok(c, await wechatImports.PreviewAsync(c, contactId, await Api.Body(c), store)));
app.MapPost("/api/v1/contacts/{contactId}/wechat-imports", async Task<IResult> (HttpContext c, string contactId) =>
{
    var input = await Api.Body(c); return Api.Ok(c, await Mutate(() => wechatImports.Commit(c, contactId, input, store)), 201);
});

JsonObject Contact(JsonObject s, string id, string user, bool pending = false) => JsonStore.Get(s, "contacts", id, user, pending);
JsonObject Record(JsonObject s, string kind, string id, string user, bool pending = false)
{
    var value = JsonStore.Get(s, kind, id, user, pending); Contact(s, value["contactId"]!.GetValue<string>(), user, pending); return value;
}
async Task<T> Mutate<T>(Func<Task<T>> action)
{
    await mutations.WaitAsync(); try { return await action(); } finally { mutations.Release(); }
}
void MarkPending(JsonObject s, string kind, string id, string operation)
{
    var row = JsonStore.Row(s, kind, id);
    if (row["pending"] is not null && row["pending"]!.GetValue<string>() != operation) throw new ApiException(409, "VERSION_CONFLICT", "该记录有未完成的修改或删除，请重试原操作");
    row["pending"] = operation;
}
async Task Invalidate(HttpContext c, string contactId, IEnumerable<string> refs, string operation, bool wholeContact)
{
    try
    {
        await gateway.Send(c, HttpMethod.Post, "/internal/v1/advice-evidence-deletions", new JsonObject
        {
            ["deletionOperationId"] = operation, ["contactId"] = contactId, ["deleteContact"] = wholeContact,
            ["evidenceRefs"] = new JsonArray(refs.Select(x => (JsonNode?)JsonValue.Create(x)).ToArray())
        });
    }
    catch (ApiException) { throw new ApiException(503, "DELETION_INCOMPLETE", "建议清理尚未完成，请重试原操作"); }
}
void ScopeRefs(JsonObject s, JsonObject input, string contactId, string user, string? self = null)
{
    foreach (var reference in Rules.Strings(input, "sourceRefs", 20))
    {
        var parts = reference.Split(':');
        var kind = parts[0] switch { "message" => "messages", "event" => "events", "preference" => "preference-records", _ => "" };
        if (parts.Length != 2 || kind == "" || parts[1] == self) throw Api.Scope();
        JsonObject value;
        try { value = JsonStore.Get(s, kind, parts[1], user); } catch (ApiException) { throw Api.Scope(); }
        if (value["contactId"]!.GetValue<string>() != contactId) throw Api.Scope();
    }
    if (input["supersedesRecordId"] is not null)
    {
        var id = input["supersedesRecordId"]!.GetValue<string>(); var previous = JsonStore.Get(s, "preference-records", id, user);
        if (id == self || previous["contactId"]!.GetValue<string>() != contactId) throw Api.Scope();
        if (input["sourceType"]!.GetValue<string>() == "MODEL_INFERENCE" && previous["hardConstraint"]!.GetValue<bool>()) throw Api.Business("未确认的推测不能替代硬边界");
    }
}
void Sequences(JsonObject s, string contactId, string user, string? excluding, JsonObject candidate)
{
    var numbers = JsonStore.Owned(s, "messages", user, true).Where(v => v["contactId"]!.GetValue<string>() == contactId && v["messageId"]!.GetValue<string>() != excluding)
        .Select(v => v["sequenceNo"]?.GetValue<int>()).Append(candidate["sequenceNo"]?.GetValue<int>()).Where(i => i.HasValue).Select(i => i!.Value).Order().ToArray();
    if (!numbers.SequenceEqual(Enumerable.Range(1, numbers.Length))) throw Api.Business("消息顺序必须从 1 连续编号且不重复");
}

app.MapGet("/api/v1/contacts", async Task<IResult> (HttpContext c) => Api.Page(c, await store.Read(s => JsonStore.Owned(s, "contacts", Api.User(c)).OrderBy(v => v["createdAt"]!.GetValue<string>(), StringComparer.Ordinal).ToArray())));
app.MapPost("/api/v1/contacts", async Task<IResult> (HttpContext c) =>
{
    var input = Rules.Input("contacts", await Api.Body(c)); var id = Api.NewId();
    var value = await Mutate(() => store.Write(s => { var v = Api.Stamp(input, "contactId", id); JsonStore.Put(s, "contacts", id, Api.User(c), v); return v; }));
    c.Response.Headers.Location = "/api/v1/contacts/" + id; return Api.Ok(c, value, 201);
});
app.MapGet("/api/v1/contacts/{contactId}", async Task<IResult> (HttpContext c, string contactId) => Api.Ok(c, await store.Read(s => Contact(s, contactId, Api.User(c)))));
app.MapPatch("/api/v1/contacts/{contactId}", async Task<IResult> (HttpContext c, string contactId) =>
{
    var patch = await Api.Body(c); var user = Api.User(c); var operation = Api.Hash(new JsonObject { ["patch"] = patch.DeepClone() });
    return await Mutate(async () =>
    {
        var next = await store.Write(s => { var old = Contact(s, contactId, user, true); Api.Match(c, old); var input = Rules.Patch("contacts", old, patch); MarkPending(s, "contacts", contactId, operation); return Api.Update(old, input); });
        await Invalidate(c, contactId, [], operation, true);
        await store.Write(s => { JsonStore.Put(s, "contacts", contactId, user, next); return true; }); return Api.Ok(c, next);
    });
});
app.MapDelete("/api/v1/contacts/{contactId}", async Task<IResult> (HttpContext c, string contactId) => await Mutate<IResult>(async () =>
{
    var user = Api.User(c); var operation = Api.Hash(new JsonObject { ["deleteContact"] = contactId });
    await store.Write(s => { var old = Contact(s, contactId, user, true); Api.Match(c, old); MarkPending(s, "contacts", contactId, operation); wechatImports.Clear(user, contactId); return true; });
    await Invalidate(c, contactId, [], operation, true);
    await store.Write(s => { foreach (var key in JsonStore.Rows(s).Where(p => p.Value!["owner"]!.GetValue<string>() == user && (p.Value!["value"]!["contactId"]?.GetValue<string>() == contactId)).Select(p => p.Key).ToArray()) JsonStore.Rows(s).Remove(key); return true; });
    return Results.NoContent();
}));

foreach (var (kind, idName, refPrefix) in new[] { ("messages", "messageId", "message"), ("events", "eventId", "event"), ("preference-records", "recordId", "preference") })
{
    app.MapGet("/api/v1/contacts/{contactId}/" + kind, async Task<IResult> (HttpContext c, string contactId) =>
    {
        var values = await store.Read(s => { Contact(s, contactId, Api.User(c)); return JsonStore.Owned(s, kind, Api.User(c)).Where(v => v["contactId"]!.GetValue<string>() == contactId).OrderBy(v => v["createdAt"]!.GetValue<string>(), StringComparer.Ordinal).ToArray(); });
        return Api.Page(c, values);
    });
    app.MapPost("/api/v1/contacts/{contactId}/" + kind, async Task<IResult> (HttpContext c, string contactId) =>
    {
        var input = Rules.Input(kind, await Api.Body(c)); var id = Api.NewId(); var user = Api.User(c);
        if (kind == "events" && input["relatedAdviceId"] is not null) throw Api.Business("建议后续请通过建议的 outcomes 接口创建");
        // Adding a hard boundary invalidates in-flight and historical advice too.
        return await Mutate(async () =>
        {
            var value = await store.Read(s =>
            {
                Contact(s, contactId, user, kind == "preference-records");
                if (kind == "messages") Sequences(s, contactId, user, null, input);
                if (kind == "preference-records") ScopeRefs(s, input, contactId, user);
                var value = Api.Stamp(input, idName, id, contactId); if (kind == "preference-records") Rules.PreferenceState(value); return value;
            });
            if (kind == "preference-records")
            {
                await store.Write(s => { MarkPending(s, "contacts", contactId, "preference-create:" + Api.Hash(input)); return true; });
                await Invalidate(c, contactId, [], id, true);
            }
            await store.Write(s =>
            {
                JsonStore.Put(s, kind, id, user, value);
                if (kind == "preference-records")
                {
                    JsonStore.Row(s, "contacts", contactId).Remove("pending");
                    if (input["supersedesRecordId"] is not null)
                    {
                        var previousId = input["supersedesRecordId"]!.GetValue<string>(); var previous = Record(s, kind, previousId, user);
                        previous["status"] = "SUPERSEDED"; previous["hardConstraint"] = false; previous["version"] = previous["version"]!.GetValue<int>() + 1; previous["updatedAt"] = Api.Now(); JsonStore.Put(s, kind, previousId, user, previous);
                    }
                }
                return true;
            });
            return Api.Ok(c, value, 201);
        });
    });
    app.MapPatch("/api/v1/" + kind + "/{id}", async Task<IResult> (HttpContext c, string id) =>
    {
        var patch = await Api.Body(c); var user = Api.User(c); var operation = Api.Hash(new JsonObject { ["patch"] = patch.DeepClone() });
        return await Mutate(async () =>
        {
            var next = await store.Write(s =>
            {
                var old = Record(s, kind, id, user, true); Contact(s, old["contactId"]!.GetValue<string>(), user); Api.Match(c, old); var input = Rules.Patch(kind, old, patch); var contactId = old["contactId"]!.GetValue<string>();
                if (kind == "messages") Sequences(s, contactId, user, id, input);
                if (kind == "preference-records") ScopeRefs(s, input, contactId, user, id);
                if (kind == "events" && input["relatedAdviceId"]?.ToJsonString() != old["relatedAdviceId"]?.ToJsonString()) throw Api.Business("不能更改事件关联的建议");
                var next = Api.Update(old, input); if (kind == "preference-records") Rules.PreferenceState(next); MarkPending(s, kind, id, operation); return next;
            });
            await Invalidate(c, next["contactId"]!.GetValue<string>(), [refPrefix + ":" + id], operation, kind == "preference-records");
            await store.Write(s => { JsonStore.Put(s, kind, id, user, next); return true; }); return Api.Ok(c, next);
        });
    });
    app.MapDelete("/api/v1/" + kind + "/{id}", async Task<IResult> (HttpContext c, string id) => await Mutate<IResult>(async () =>
    {
        var user = Api.User(c); var operation = Api.Hash(new JsonObject { ["delete"] = refPrefix + ":" + id });
        var deletion = await store.Write(s =>
        {
            var value = Record(s, kind, id, user, true); var contactId = value["contactId"]!.GetValue<string>(); Contact(s, contactId, user); Api.Match(c, value);
            var refs = new HashSet<string> { refPrefix + ":" + id }; var keys = new HashSet<string> { kind + "/" + id };
            bool changed;
            do
            {
                changed = false;
                foreach (var preference in JsonStore.Owned(s, "preference-records", user, true).Where(p => p["contactId"]!.GetValue<string>() == contactId))
                    if (preference["sourceRefs"]!.AsArray().Any(r => refs.Contains(r!.GetValue<string>())) && refs.Add("preference:" + preference["recordId"]!.GetValue<string>()))
                    { keys.Add("preference-records/" + preference["recordId"]!.GetValue<string>()); changed = true; }
            } while (changed);
            foreach (var key in keys) { var parts = key.Split('/'); MarkPending(s, parts[0], parts[1], operation); }
            return (contactId, refs, keys);
        });
        await Invalidate(c, deletion.contactId, deletion.refs, operation, false);
        await store.Write(s =>
        {
            foreach (var key in deletion.keys) JsonStore.Rows(s).Remove(key);
            // Removing an explicitly ordered message closes the remaining sequence gap.
            var ordered = JsonStore.Owned(s, "messages", user).Where(v => v["contactId"]!.GetValue<string>() == deletion.contactId && v["sequenceNo"] is not null).OrderBy(v => v["sequenceNo"]!.GetValue<int>()).ToArray();
            for (var i = 0; i < ordered.Length; i++) if (ordered[i]["sequenceNo"]!.GetValue<int>() != i + 1)
            { var v = Api.Update(ordered[i], new JsonObject { ["sequenceNo"] = i + 1 }); JsonStore.Put(s, "messages", v["messageId"]!.GetValue<string>(), user, v); }
            return true;
        });
        return Results.NoContent();
    }));
}

app.MapPost("/internal/v1/context-queries", async Task<IResult> (HttpContext c) =>
{
    var input = await Api.Body(c); if (!input.ContainsKey("includeWritingStyle")) input["includeWritingStyle"] = false;
    Rules.Keys(input, "requestId contactId selectedMessageIds selectedEventIds selectedPreferenceIds includeApplicableHardBoundaries includeWritingStyle"); Rules.Bool(input, "includeWritingStyle");
    Api.Uuid(Rules.Text(input, "requestId", 36)); var contactId = Api.Uuid(Rules.Text(input, "contactId", 36)); Rules.Bool(input, "includeApplicableHardBoundaries");
    if (!input["includeApplicableHardBoundaries"]!.GetValue<bool>()) throw Api.Business("分析必须自动纳入硬边界");
    var user = Api.User(c);
    var bundle = await store.Read(s =>
    {
        var contact = Contact(s, contactId, user); var result = new JsonObject { ["contact"] = contact };
        foreach (var (field, kind, limit, output) in new[] { ("selectedMessageIds", "messages", 200, "messages"), ("selectedEventIds", "events", 50, "events"), ("selectedPreferenceIds", "preference-records", 50, "preferenceRecords") })
        {
            var values = new JsonArray();
            foreach (var id in Rules.Strings(input, field, limit, 36, true))
            {
                JsonObject value;
                try { value = Record(s, kind, id, user); } catch (ApiException) { throw Api.Scope(); }
                if (value["contactId"]!.GetValue<string>() != contactId || value["status"]?.GetValue<string>() is "REJECTED" or "SUPERSEDED") throw Api.Scope(); values.Add(value);
            }
            result[output] = values;
        }
        var selected = Rules.Strings(input, "selectedPreferenceIds", 50, 36, true); var auto = new JsonArray();
        foreach (var boundary in JsonStore.Owned(s, "preference-records", user, true).Where(v => v["contactId"]!.GetValue<string>() == contactId && v["hardConstraint"]!.GetValue<bool>() && v["status"]!.GetValue<string>() is not ("SUPERSEDED" or "REJECTED")))
        {
            var id = boundary["recordId"]!.GetValue<string>();
            if (JsonStore.Row(s, "preference-records", id)["pending"] is not null) throw new ApiException(503, "DELETION_INCOMPLETE", "硬边界正在修改，请稍后重试");
            if (!selected.Contains(id)) { result["preferenceRecords"]!.AsArray().Add(boundary); auto.Add(id); }
        }
        // Conditional hard boundaries are conservatively included; the model must honor appliesWhen.
        result["selectedPreferenceIds"] = input["selectedPreferenceIds"]!.DeepClone(); result["autoIncludedPreferenceIds"] = auto;
        if (input["includeWritingStyle"]!.GetValue<bool>()) result["writingStyle"] = WritingStyleLearning.Build(JsonStore.Owned(s, "messages", user), contactId);
        return result;
    });
    return Api.Ok(c, bundle);
});

app.MapPost("/internal/v1/contacts/{contactId}/outcomes", async Task<IResult> (HttpContext c, string contactId) =>
{
    var input = Rules.Input("events", await Api.Body(c)); if (input["relatedAdviceId"] is null) throw Api.Invalid("必须关联建议");
    var value = await Mutate(() => store.Write(s => { Contact(s, contactId, Api.User(c)); var id = Api.NewId(); var v = Api.Stamp(input, "eventId", id, contactId); JsonStore.Put(s, "events", id, Api.User(c), v); return v; })); return Api.Ok(c, value, 201);
});
app.MapDelete("/api/v1/me/context-data", async Task<IResult> (HttpContext c) => await Mutate<IResult>(async () =>
{
    var user = Api.User(c);
    await store.Write(s => { foreach (var v in JsonStore.Owned(s, "contacts", user, true)) JsonStore.Row(s, "contacts", v["contactId"]!.GetValue<string>())["pending"] = "delete-all"; wechatImports.Clear(user); return true; });
    try { await gateway.Send(c, HttpMethod.Delete, "/internal/v1/users/" + user + "/advice-data"); }
    catch (ApiException) { throw new ApiException(503, "DELETION_INCOMPLETE", "建议清理尚未完成，请重试删除"); }
    await store.Write(s => { foreach (var key in JsonStore.Rows(s).Where(p => p.Value!["owner"]!.GetValue<string>() == user).Select(p => p.Key).ToArray()) JsonStore.Rows(s).Remove(key); return true; }); return Results.NoContent();
}));
app.Run();
