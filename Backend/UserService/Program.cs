using Betweenly.Accounts;
using Betweenly.Shared;
using Betweenly.Users;

var app = AccountHost.Create("user-service", 5106, args);
var database = app.Services.GetRequiredService<AccountDatabase>();
await database.Initialize("users", app.Configuration.GetValue<bool>("Accounts:InitializeSchema"));
var users = new UserRepository(database);
app.MapPost("/internal/v1/users", async (HttpContext context) =>
{
    AccountHost.AuthCaller(context);
    var caller = AccountHost.User(context);
    var input = await Api.Body(context); Rules.Keys(input, "userId username");
    var id = Api.Uuid(AccountValidation.Text(input, "userId", 36, 36));
    if (id != caller) throw new ApiException(403, "FORBIDDEN", "注册用户作用域不匹配");
    return Api.Ok(context, await users.Create(id, AccountValidation.Username(input), context.RequestAborted), 201);
});
app.MapGet("/api/v1/users/me", async Task<IResult> (HttpContext context) => Api.Ok(context, await users.Get(AccountHost.User(context), context.RequestAborted)));
app.MapPatch("/api/v1/users/me", async (HttpContext context) =>
{
    var user = AccountHost.User(context);
    var input = await Api.Body(context); Rules.Keys(input, "displayName bio", required: false);
    if (input.Count == 0 || input.Any(pair => pair.Value is null)) throw Api.Invalid("至少提供一个非空资料字段");
    var versionText = context.Request.Headers.IfMatch.ToString().Trim('"');
    if (!int.TryParse(versionText, out var version) || version < 1) throw new ApiException(409, "VERSION_CONFLICT", "请提供当前资料版本 If-Match");
    var name = input.ContainsKey("displayName") ? AccountValidation.Text(input, "displayName", 1, 64) : null;
    var bio = input.ContainsKey("bio") ? AccountValidation.Text(input, "bio", 0, 500) : null;
    await users.Update(user, version, name, bio, context.RequestAborted);
    return Api.Ok(context, await users.Get(user, context.RequestAborted));
});
app.Run();
