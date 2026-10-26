using System.Text.Json;
using SocialAssistant.Gateway.Configuration;
using SocialAssistant.Gateway.Http;
using SocialAssistant.Gateway.Proxy;
using SocialAssistant.Gateway.Routing;
using SocialAssistant.Gateway.Security;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using System.Net;

var builder = WebApplication.CreateBuilder(args);
var trustedProxyAddresses = builder.Configuration.GetSection("Gateway:TrustedProxies").Get<string[]>() ?? [];
if (trustedProxyAddresses.Length > 0)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.KnownNetworks.Clear(); options.KnownProxies.Clear();
        foreach (var address in trustedProxyAddresses) options.KnownProxies.Add(IPAddress.Parse(address));
        options.ForwardLimit = 1;
    });
}

builder.Services
    .AddOptions<GatewayOptions>()
    .Bind(builder.Configuration.GetSection(GatewayOptions.SectionName))
    .Validate(
        options => options.Services.Count > 0,
        "At least one downstream service must be configured.")
    .Validate(
        options => options.Services.All(pair =>
            Uri.TryCreate(pair.Value.BaseUrl, UriKind.Absolute, out var uri) &&
            (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)),
        "Every downstream service BaseUrl must be an absolute HTTP(S) URL.")
    .ValidateOnStart();
builder.Services.AddOptions<GatewayOptions>()
    .Validate(options => !options.AccountAuth.Enabled || (!options.DevelopmentAuth.Enabled && !options.DesktopAuth.Enabled), "Account authentication cannot be combined with development or desktop identity.")
    .Validate(options => !options.AccountAuth.Enabled || new[] { GatewayServiceNames.Auth, GatewayServiceNames.User }.All(name => options.Services.TryGetValue(name, out var service) && service.GatewayKey.Length >= 32), "Account services require configured URLs and gateway keys of at least 32 characters.")
    .Validate(options => !options.AccountAuth.Enabled || options.ServiceCredentials.TryGetValue(CallerServiceNames.Auth, out var key) && key.Length >= 32, "AuthService requires a service credential of at least 32 characters.")
    .ValidateOnStart();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.PropertyNameCaseInsensitive = true;
});

builder.Services.AddCors(options => options.AddPolicy("Frontend", policy =>
{
    var origins = builder.Configuration
        .GetSection("Gateway:Cors:AllowedOrigins").Get<string[]>() ?? [];
    if (origins.Length > 0)
    {
        policy.WithOrigins(origins);
    }

    policy.WithMethods("GET", "POST", "PUT", "PATCH", "DELETE")
        .WithHeaders("Authorization", "Content-Type", "X-Dev-User-Id",
            "X-Correlation-Id", "Idempotency-Key", "If-Match")
        .WithExposedHeaders("X-Correlation-Id", "ETag", "Retry-After", "Location", "Allow");
}));

builder.Services.AddSingleton<RouteCatalog>();
builder.Services.AddSingleton<ServiceCredentialValidator>();
builder.Services.AddSingleton<UserIdentityResolver>();
builder.Services.AddSingleton<AuthTokenClient>();
builder.Services.AddSingleton<GatewayProxy>();
builder.Services.AddSingleton<ReadinessProbe>();
builder.Services.AddHttpClient(GatewayProxy.ClientName, client =>
    client.Timeout = Timeout.InfiniteTimeSpan)
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false
    });
builder.Services.AddHttpClient(ReadinessProbe.ClientName, client =>
    client.Timeout = Timeout.InfiniteTimeSpan)
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false
    });
builder.Services.AddHttpClient(AuthTokenClient.ClientName, client => client.Timeout = Timeout.InfiniteTimeSpan)
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false });
builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        context.Request.Method == "POST" && (context.Request.Path.Value?.TrimEnd('/') is "/api/v1/auth/registration-codes" or "/api/v1/auth/email-verification-requests" or "/api/v1/auth/password-reset-codes")
            ? RateLimitPartition.GetFixedWindowLimiter("email:" + (context.Connection.RemoteIpAddress?.ToString() ?? "unknown"), _ => new FixedWindowRateLimiterOptions { PermitLimit = Math.Clamp(builder.Configuration.GetValue<int?>("Gateway:EmailCodeRequestsPerMinute") ?? 5, 1, 1000), Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })
            : context.Request.Path.StartsWithSegments("/api/v1/auth") && context.Request.Method is "POST" or "PUT"
            ? RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = Math.Clamp(builder.Configuration.GetValue<int?>("Gateway:AccountRequestsPerMinute") ?? 60, 1, 1000), Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })
            : RateLimitPartition.GetNoLimiter("unlimited"));
    options.OnRejected = async (context, _) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await ApiErrorWriter.WriteAsync(context.HttpContext, 429, "RATE_LIMITED", "请求过于频繁，请稍后重试");
    };
});

var app = builder.Build();
if (trustedProxyAddresses.Length > 0) app.UseForwardedHeaders();

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        var traceId = ApiErrorWriter.GetTraceId(context);
        context.Response.Headers[ApiErrorWriter.CorrelationHeader] = traceId;
        await ApiErrorWriter.WriteAsync(
            context,
            StatusCodes.Status500InternalServerError,
            "INTERNAL_ERROR",
            "服务暂时无法处理该请求");
    });
});

app.UseWhen(
    context => context.Request.Path.StartsWithSegments("/api"),
    publicApi => publicApi.UseCors("Frontend"));
app.UseRateLimiter();
app.UseMiddleware<GatewayMiddleware>();

app.MapGet("/healthz", () => Results.Ok(new
{
    status = "healthy",
    service = "api-gateway"
}));

app.MapGet("/readyz", async (
    ReadinessProbe probe,
    CancellationToken cancellationToken) =>
{
    var result = await probe.CheckAsync(cancellationToken);
    return result.IsReady
        ? Results.Ok(result)
        : Results.Json(result, statusCode: StatusCodes.Status503ServiceUnavailable);
});

app.Run();

public partial class Program;
