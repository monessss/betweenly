using Betweenly.Accounts;
using Betweenly.Auth;
using Betweenly.Shared;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using System.Text.Json.Nodes;

var app = AccountHost.Create("auth-service", 5105, args);
var database = app.Services.GetRequiredService<AccountDatabase>();
await database.Initialize("auth", app.Configuration.GetValue<bool>("Accounts:InitializeSchema"));
var repository = new AuthRepository(database);
var administrators = new AdminRepository(database);
var emailVerification = new EmailVerificationRepository(database, app.Configuration["Email:VerificationSecret"] ?? "");
var emailSender = new VerificationEmailSender(app.Configuration);
var hasher = new PasswordHasher<Credential>(Options.Create(new PasswordHasherOptions { IterationCount = 210_000 }));
var dummy = new Credential(Api.NewId(), "unused@example.invalid", "unused", "", "ACTIVE");
var dummyHash = hasher.HashPassword(dummy, Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)));
using var gateway = new InternalClient("AuthService", app.Configuration["SERVICE_CREDENTIAL"] ?? "");
if ((app.Configuration["SERVICE_CREDENTIAL"] ?? "").Length < 32) throw new InvalidOperationException("SERVICE_CREDENTIAL must contain at least 32 characters.");

bool Matches(Credential? credential, string password)
    => hasher.VerifyHashedPassword(credential ?? dummy, credential?.PasswordHash ?? dummyHash, password) != PasswordVerificationResult.Failed && credential is not null;

async Task Provision(HttpContext context, Credential credential)
{
    context.Items["user"] = credential.UserId;
    var profile = await gateway.Send(context, HttpMethod.Post, "/internal/v1/users", new JsonObject { ["userId"] = credential.UserId, ["username"] = credential.Username }) as JsonObject;
    if (profile?["userId"]?.GetValue<string>() != credential.UserId || profile?["username"]?.GetValue<string>() != credential.Username)
        throw new ApiException(503, "SERVICE_UNAVAILABLE", "用户资料尚未创建，请重试注册或登录");
}

string Code(JsonObject input)
{
    var code = AccountValidation.Text(input, "verificationCode", 6, 6);
    if (!code.All(char.IsAsciiDigit)) throw Api.Invalid("请输入 6 位数字验证码");
    return code;
}
async Task<IResult> SendCode(HttpContext context, string email, string purpose, string? user)
{
    emailSender.RequireConfiguration();
    await repository.CheckAttempt("email-send", email, context.RequestAborted);
    var code = System.Security.Cryptography.RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
    var challenge = await emailVerification.BeginSend(email, purpose, user, code, context.RequestAborted);
    try
    {
        if (purpose != "PASSWORD_RESET" || user is not null)
            await emailSender.Send(email, code, context.RequestAborted, purpose == "PASSWORD_RESET");
        await emailVerification.Delivery(challenge.Id, purpose != "PASSWORD_RESET" || user is not null, context.RequestAborted);
    }
    catch
    {
        // A failed or uncertain SMTP submission never produces a usable challenge.
        await emailVerification.Delivery(challenge.Id, false, CancellationToken.None);
        throw;
    }
    return Api.Ok(context, new JsonObject { ["challengeId"] = challenge.Id, ["expiresAt"] = challenge.Expires.ToString("O"), ["retryAfterSeconds"] = 60 }, 202);
}
app.MapPost("/api/v1/auth/registration-codes", async (HttpContext context) =>
{
    var input = await Api.Body(context); Rules.Keys(input, "email");
    return await SendCode(context, AccountValidation.Email(input), "REGISTER", null);
});
app.MapPost("/api/v1/auth/password-reset-codes", async (HttpContext context) =>
{
    var input = await Api.Body(context); Rules.Keys(input, "email");
    var email = AccountValidation.Email(input); var account = await repository.Find(email, context.RequestAborted);
    // The same receipt/cooldown is returned for unknown and unverified addresses.
    // Legacy unverified login identifiers cannot be used to claim an account.
    var eligible = account is { Status: "ACTIVE" } && await emailVerification.IsVerified(account.UserId, email, context.RequestAborted);
    return await SendCode(context, email, "PASSWORD_RESET", eligible ? account!.UserId : null);
});
app.MapPost("/api/v1/auth/password-resets", async Task<IResult> (HttpContext context) =>
{
    var input = await Api.Body(context); Rules.Keys(input, "email challengeId verificationCode newPassword");
    var email = AccountValidation.Email(input); var challenge = Api.Uuid(AccountValidation.Text(input, "challengeId", 36, 36));
    var code = Code(input); var password = AccountValidation.Text(input, "newPassword", 6, 128, false);
    await repository.CheckAttempt("password-reset", email, context.RequestAborted);
    emailSender.RequireConfiguration();
    var account = await repository.Find(email, context.RequestAborted);
    if (account is not { Status: "ACTIVE" }) throw new ApiException(422, "EMAIL_CODE_INVALID", "验证码无效、已使用或已过期，请重新获取");
    await emailVerification.ResetPassword(account, challenge, code, hasher.HashPassword(account, password), context.RequestAborted);
    return Results.NoContent();
});
app.MapPost("/api/v1/auth/email-verification-requests", async (HttpContext context) =>
{
    var input = await Api.Body(context); Rules.Keys(input, "");
    var user = AccountHost.User(context); var account = await repository.FindById(user, context.RequestAborted) ?? throw Api.Missing();
    return await SendCode(context, account.Email, "ACCOUNT", user);
});
app.MapPost("/api/v1/auth/email-verifications", async (HttpContext context) =>
{
    var input = await Api.Body(context); Rules.Keys(input, "challengeId verificationCode");
    var user = AccountHost.User(context); var account = await repository.FindById(user, context.RequestAborted) ?? throw Api.Missing();
    await emailVerification.RequireSchema(context.RequestAborted);
    await emailVerification.VerifyAccount(user, account.Email, Api.Uuid(AccountValidation.Text(input, "challengeId", 36, 36)), Code(input), context.RequestAborted);
    return Api.Ok(context, new JsonObject { ["emailVerified"] = true });
});

app.MapPost("/api/v1/auth/registrations", async (HttpContext context) =>
{
    var input = await Api.Body(context); Rules.Keys(input, "username email password deviceName challengeId verificationCode", required: false);
    var email = AccountValidation.Email(input); var username = AccountValidation.Username(input);
    if (AccountValidation.NormalizeUsername(username) == "ADMIN") throw new ApiException(409, "ACCOUNT_EXISTS", "该用户名不可用于注册");
    var password = AccountValidation.Text(input, "password", 6, 128, false);
    var device = AccountValidation.Optional(input, "deviceName", 80);
    await repository.CheckAttempt("register", email, context.RequestAborted);
    var candidate = new Credential(Api.NewId(), email, username, "", "PROVISIONING");
    candidate = candidate with { PasswordHash = hasher.HashPassword(candidate, password) };
    var existing = await repository.Find(email, context.RequestAborted);
    var recovering = existing is { Status: "PROVISIONING" } && existing.Username == username && Matches(existing, password)
        && await emailVerification.IsVerified(existing.UserId, email, context.RequestAborted);
    Credential? reserved;
    if (recovering) reserved = existing;
    else
    {
        if (existing is not null) throw new ApiException(409, "ACCOUNT_EXISTS", "用户名或邮箱已被使用");
        var challengeId = Api.Uuid(AccountValidation.Text(input, "challengeId", 36, 36));
        var code = Code(input);
        emailSender.RequireConfiguration();
        reserved = await emailVerification.ReserveRegistration(candidate, challengeId, code, context.RequestAborted);
    }
    if (reserved is null)
    {
        reserved = await repository.Find(email, context.RequestAborted);
        if (reserved is null || reserved.Status != "PROVISIONING" || reserved.Username != username || !Matches(reserved, password)
            || !await emailVerification.IsVerified(reserved.UserId, email, context.RequestAborted))
            throw new ApiException(409, "ACCOUNT_EXISTS", "用户名或邮箱已被使用");
    }
    // Keep a durable PROVISIONING credential on upstream failure. Retrying with the
    // same password repairs profile creation without deleting or hijacking accounts.
    await Provision(context, reserved);
    var session = await repository.CreateSession(reserved, device, true, context.RequestAborted);
    context.Response.Headers.Location = "/api/v1/users/me";
    return Api.Ok(context, session, 201);
});

app.MapPost("/api/v1/auth/sessions", async (HttpContext context) =>
{
    var input = await Api.Body(context); Rules.Keys(input, "email password deviceName", required: false);
    var identifier = AccountValidation.Text(input, "email", 2, 254);
    identifier = identifier.Contains('@') ? AccountValidation.Email(input) : AccountValidation.Username(new JsonObject { ["username"] = identifier });
    var password = AccountValidation.Text(input, "password", 1, 128, false);
    var credential = await repository.FindLogin(identifier, context.RequestAborted);
    await repository.CheckAttempt("login", credential?.Email ?? AccountValidation.NormalizeUsername(identifier), context.RequestAborted);
    if (!Matches(credential, password) || credential!.Status is not ("ACTIVE" or "PROVISIONING")) throw new ApiException(401, "AUTH_REQUIRED", "账号或密码错误");
    if (credential.Status == "PROVISIONING") await Provision(context, credential);
    return Api.Ok(context, await repository.CreateSession(credential, AccountValidation.Optional(input, "deviceName", 80), credential.Status == "PROVISIONING", context.RequestAborted), 201);
});

app.MapPost("/api/v1/auth/tokens", async (HttpContext context) =>
{
    var input = await Api.Body(context); Rules.Keys(input, "refreshToken");
    return Api.Ok(context, await repository.Refresh(AccountValidation.Text(input, "refreshToken", 1, 256, false), context.RequestAborted));
});
app.MapPost("/internal/v1/auth/introspections", async (HttpContext context) =>
{
    var input = await Api.Body(context); Rules.Keys(input, "token");
    return Api.Ok(context, await repository.Introspect(AccountValidation.Text(input, "token", 1, 256, false), context.RequestAborted));
});
app.MapGet("/api/v1/auth/account", async (HttpContext context) =>
{
    var user = AccountHost.User(context); var value = await repository.FindById(user, context.RequestAborted) ?? throw Api.Missing();
    return Api.Ok(context, new JsonObject { ["userId"] = value.UserId, ["email"] = value.Email, ["username"] = value.Username, ["emailVerified"] = await emailVerification.IsVerified(user, value.Email, context.RequestAborted), ["role"] = await administrators.Role(user, context.RequestAborted) });
});

app.MapGet("/api/v1/admin/users", async (HttpContext context) =>
{
    await administrators.Require(AccountHost.User(context), context.RequestAborted);
    if (context.Request.Query.Keys.Any(key => key is not ("q" or "page"))) throw Api.Invalid("不支持的查询参数");
    var search = context.Request.Query["q"].ToString().Trim();
    if (search.Length > 100 || search.Any(char.IsControl)) throw Api.Invalid("搜索内容过长或格式无效");
    var rawPage = context.Request.Query["page"].ToString(); var page = 1;
    if (rawPage.Length > 0 && (!int.TryParse(rawPage, out page) || page is < 1 or > 100000)) throw Api.Invalid("页码无效");
    return Api.Ok(context, await administrators.List(search, page, context.RequestAborted));
});
app.MapGet("/api/v1/admin/users/{userId}", async (HttpContext context, string userId) =>
{
    await administrators.Require(AccountHost.User(context), context.RequestAborted);
    return Api.Ok(context, await administrators.Detail(Api.Uuid(userId), context.RequestAborted));
});
app.MapPut("/api/v1/admin/users/{userId}/password", async Task<IResult> (HttpContext context, string userId) =>
{
    var actor = AccountHost.User(context); await administrators.Require(actor, context.RequestAborted);
    var input = await Api.Body(context); Rules.Keys(input, "newPassword");
    var password = AccountValidation.Text(input, "newPassword", 6, 128, false);
    await repository.CheckAttempt("admin-password", actor, context.RequestAborted);
    var target = await repository.FindById(Api.Uuid(userId), context.RequestAborted) ?? throw Api.Missing();
    if (target.Status == "DELETED") throw Api.Missing();
    await administrators.ResetPassword(actor, target, hasher.HashPassword(target, password), context.RequestAborted);
    return Results.NoContent();
});
app.MapPut("/api/v1/admin/users/{userId}/ban", async Task<IResult> (HttpContext context, string userId) =>
{
    var actor = AccountHost.User(context); await administrators.Require(actor, context.RequestAborted);
    var input = await Api.Body(context); Rules.Keys(input, "durationMinutes"); int? minutes = null;
    if (input["durationMinutes"] is not null)
    {
        if (input["durationMinutes"] is not JsonValue value || !value.TryGetValue<int>(out var duration) || duration is < 1 or > 525600) throw Api.Invalid("封禁时长应为 1–525600 分钟，或 null 表示永久");
        minutes = duration;
    }
    await repository.CheckAttempt("admin-access", actor, context.RequestAborted);
    await administrators.ChangeAccess(actor, Api.Uuid(userId), "USER_BANNED", minutes, context.RequestAborted); return Results.NoContent();
});
app.MapDelete("/api/v1/admin/users/{userId}/ban", async Task<IResult> (HttpContext context, string userId) =>
{
    var actor = AccountHost.User(context); await administrators.Require(actor, context.RequestAborted);
    await repository.CheckAttempt("admin-access", actor, context.RequestAborted);
    await administrators.ChangeAccess(actor, Api.Uuid(userId), "USER_UNBANNED", null, context.RequestAborted); return Results.NoContent();
});
app.MapDelete("/api/v1/admin/users/{userId}", async Task<IResult> (HttpContext context, string userId) =>
{
    var actor = AccountHost.User(context); await administrators.Require(actor, context.RequestAborted);
    await repository.CheckAttempt("admin-access", actor, context.RequestAborted);
    await administrators.ChangeAccess(actor, Api.Uuid(userId), "USER_DELETED", null, context.RequestAborted); return Results.NoContent();
});
app.MapGet("/api/v1/auth/sessions", async Task<IResult> (HttpContext context) => Api.Ok(context, await repository.Sessions(AccountHost.User(context), context.RequestAborted)));
app.MapDelete("/api/v1/auth/sessions/{sessionId}", async (HttpContext context, string sessionId) =>
{
    await repository.Revoke(AccountHost.User(context), Api.Uuid(sessionId), context.RequestAborted); return Results.NoContent();
});
app.MapPost("/api/v1/auth/logout", async (HttpContext context) =>
{
    var session = context.Request.Headers["X-Session-Id"];
    if (session.Count != 1) throw new ApiException(401, "AUTH_REQUIRED", "需要有效登录会话");
    await repository.Revoke(AccountHost.User(context), Api.Uuid(session[0]), context.RequestAborted); return Results.NoContent();
});
app.MapPut("/api/v1/auth/password", async (HttpContext context) =>
{
    var user = AccountHost.User(context); var input = await Api.Body(context); Rules.Keys(input, "currentPassword newPassword");
    var credential = await repository.FindById(user, context.RequestAborted);
    var current = AccountValidation.Text(input, "currentPassword", 1, 128, false);
    var password = AccountValidation.Text(input, "newPassword", 6, 128, false);
    await repository.CheckAttempt("password", user, context.RequestAborted);
    if (!Matches(credential, current)) throw new ApiException(401, "AUTH_REQUIRED", "当前密码错误");
    await repository.ChangePassword(credential!, hasher.HashPassword(credential!, password), context.RequestAborted); return Results.NoContent();
});
app.Run();
