using Betweenly.Shared;
using System.Text.Json.Nodes;

var app = Api.Create("expression-style-service", 5101);
using var store = new JsonStore("expression-style");
app.MapGet("/readyz", () => Results.Ok(new { status = "ready" }));
app.MapGet("/api/v1/me/expression-style", async Task<IResult> (HttpContext c) => Api.Ok(c, await store.Read(s => JsonStore.Get(s, "style", Api.User(c), Api.User(c)))));
app.MapGet("/internal/v1/users/{userId}/expression-style", async Task<IResult> (HttpContext c, string userId) =>
{
    if (Api.Uuid(userId) != Api.User(c)) throw Api.Missing();
    return Api.Ok(c, await store.Read(s => JsonStore.Get(s, "style", userId, userId)));
});
app.MapPut("/api/v1/me/expression-style", async Task<IResult> (HttpContext c) =>
{
    var input = Rules.Input("style", await Api.Body(c)); var user = Api.User(c);
    var value = await store.Write(s =>
    {
        var old = JsonStore.Owned(s, "style", user).SingleOrDefault();
        if (old is not null) Api.Match(c, old);
        else if (c.Request.Headers.ContainsKey("If-Match")) throw new ApiException(409, "VERSION_CONFLICT", "表达习惯不存在");
        var value = (JsonObject)input.DeepClone(); value["userId"] = user; value["version"] = (old?["version"]?.GetValue<int>() ?? 0) + 1; value["updatedAt"] = Api.Now();
        JsonStore.Put(s, "style", user, user, value); return value;
    });
    return Api.Ok(c, value);
});
app.MapDelete("/api/v1/me/expression-style", async Task<IResult> (HttpContext c) =>
{
    await store.Write(s => { var value = JsonStore.Get(s, "style", Api.User(c), Api.User(c)); Api.Match(c, value); return JsonStore.Rows(s).Remove("style/" + Api.User(c)); });
    return Results.NoContent();
});
app.MapGet("/api/v1/me/voice-corpus", async Task<IResult> (HttpContext c) => Api.Ok(c, await store.Read(s => PersonalVoice.Status(s, Api.User(c)))));
app.MapGet("/api/v1/me/voice-corpus/samples", async Task<IResult> (HttpContext c) =>
    Api.Page(c, await store.Read(s => JsonStore.Owned(s, "voice", Api.User(c)).OrderByDescending(v => v["createdAt"]!.GetValue<string>(), StringComparer.Ordinal).ThenBy(v => v["sampleId"]!.GetValue<string>(), StringComparer.Ordinal).ToArray())));
app.MapPost("/api/v1/me/voice-corpus/imports", async Task<IResult> (HttpContext c) =>
{
    var input = await Api.Body(c); return Api.Ok(c, await store.Write(s => PersonalVoice.Import(s, Api.User(c), input)), 201);
});
app.MapPut("/api/v1/me/voice-corpus/samples/{sampleId}", async Task<IResult> (HttpContext c, string sampleId) =>
{
    var input = PersonalVoice.Input(await Api.Body(c)); var user = Api.User(c);
    return Api.Ok(c, await store.Write(s =>
    {
        var old = JsonStore.Get(s, "voice", sampleId, user); Api.Match(c, old);
        if (JsonStore.Owned(s, "voice", user).Any(v => v["sampleId"]!.GetValue<string>() != sampleId && PersonalVoice.Fingerprint(v) == PersonalVoice.Fingerprint(input)))
            throw Api.Business("相同语料已经存在");
        var value = (JsonObject)old.DeepClone(); value["text"] = input["text"]!.DeepClone(); value["situation"] = input["situation"]!.DeepClone();
        value["version"] = old["version"]!.GetValue<int>() + 1; value["updatedAt"] = Api.Now();
        JsonStore.Put(s, "voice", sampleId, user, value); PersonalVoice.Changed(s, user, true); return value;
    }));
});
app.MapDelete("/api/v1/me/voice-corpus/samples/{sampleId}", async Task<IResult> (HttpContext c, string sampleId) =>
{
    await store.Write(s => { var user = Api.User(c); Api.Match(c, JsonStore.Get(s, "voice", sampleId, user)); JsonStore.Rows(s).Remove("voice/" + sampleId); PersonalVoice.Changed(s, user, true); return true; });
    return Results.NoContent();
});
app.MapDelete("/api/v1/me/voice-corpus", async Task<IResult> (HttpContext c) =>
{
    var input = await Api.Body(c); Rules.Keys(input, "confirmation"); if (Rules.Text(input, "confirmation", 10) != "删除") throw Api.Invalid("请输入删除确认");
    await store.Write(s => { var user = Api.User(c); foreach (var v in JsonStore.Owned(s, "voice", user).ToArray()) JsonStore.Rows(s).Remove("voice/" + v["sampleId"]!.GetValue<string>()); PersonalVoice.Changed(s, user, true); return true; });
    return Results.NoContent();
});
app.MapGet("/internal/v1/users/{userId}/voice-corpus", async Task<IResult> (HttpContext c, string userId) =>
{
    if (Api.Uuid(userId) != Api.User(c)) throw Api.Missing(); return Api.Ok(c, await store.Read(s => PersonalVoice.Status(s, userId)));
});
app.MapPost("/internal/v1/voice-queries", async Task<IResult> (HttpContext c) =>
{
    var input = await Api.Body(c); Rules.Keys(input, "userGoal query"); Rules.Enum(input, "userGoal", Rules.Goals); var query = Rules.Text(input, "query", 4000, false, 0);
    return Api.Ok(c, await store.Read(s => PersonalVoice.Select(s, Api.User(c), input["userGoal"]!.GetValue<string>(), query)));
});
app.Run();
