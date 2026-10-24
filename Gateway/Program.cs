using System.Text.Json;
using SocialAssistant.Gateway.Configuration;
using SocialAssistant.Gateway.Http;
using SocialAssistant.Gateway.Proxy;
using SocialAssistant.Gateway.Routing;
using SocialAssistant.Gateway.Security;

var builder = WebApplication.CreateBuilder(args);

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

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.PropertyNameCaseInsensitive = true;
});

builder.Services.AddSingleton<RouteCatalog>();
builder.Services.AddSingleton<ServiceCredentialValidator>();
builder.Services.AddSingleton<UserIdentityResolver>();
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

var app = builder.Build();

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
