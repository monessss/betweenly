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
app.Run();
