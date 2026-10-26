using Betweenly.Shared;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MySqlConnector;
using System.Text.Json;
using System.Security.Cryptography;
using System.Text;

namespace Betweenly.Accounts;

public static class AccountHost
{
    public static WebApplication Create(string name, int port, string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Logging.ClearProviders();
        builder.Logging.AddSimpleConsole();
        builder.WebHost.UseSetting("urls", builder.Configuration["urls"] ?? builder.Configuration["ASPNETCORE_URLS"] ?? $"http://127.0.0.1:{port}");
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 32 * 1024);
        builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
        builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);
        var key = builder.Configuration["GATEWAY_KEY"] ?? "";
        if (key.Length < 32) throw new InvalidOperationException("GATEWAY_KEY must contain at least 32 characters.");
        var connection = builder.Configuration.GetConnectionString("Accounts") ?? builder.Configuration["MYSQL_CONNECTION_STRING"];
        if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("ConnectionStrings:Accounts is required. Use a new, empty MySQL database.");
        builder.Services.AddSingleton(new AccountDatabase(connection));
        var app = builder.Build();
        app.Use(async (context, next) =>
        {
            var trace = context.Request.Headers["X-Correlation-Id"].ToString();
            context.Items["trace"] = trace.Length is > 0 and <= 128 && trace.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.') ? trace : Api.NewId();
            context.Response.Headers["X-Correlation-Id"] = Api.Trace(context);
            context.Response.Headers.CacheControl = "no-store";
            try
            {
                if (context.Request.Path != "/healthz" && context.Request.Path != "/readyz")
                {
                    var supplied = context.Request.Headers["X-Gateway-Key"];
                    if (supplied.Count != 1 || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes(supplied[0] ?? "")))
                        throw new ApiException(403, "FORBIDDEN", "仅接受 Gateway 转发的请求");
                }
                await next(context);
            }
            catch (ApiException error) { if (error.Status == 429) context.Response.Headers.RetryAfter = error.Code == "EMAIL_RESEND_TOO_SOON" ? "60" : "900"; await Api.Error(context, error.Status, error.Code, error.Message); }
            catch (Exception error) when (error is JsonException or FormatException or BadHttpRequestException)
            {
                var large = error is BadHttpRequestException { StatusCode: 413 };
                await Api.Error(context, large ? 413 : 400, large ? "INPUT_TOO_LARGE" : "VALIDATION_ERROR", "请求格式或大小不符合要求");
            }
            catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
            catch (MySqlException) { app.Logger.LogError("Account database operation failed; trace={Trace}", Api.Trace(context)); await Api.Error(context, 503, "SERVICE_UNAVAILABLE", "账号数据库暂时不可用"); }
            catch (Exception error) { app.Logger.LogError("Account operation failed; type={Type}; trace={Trace}", error.GetType().Name, Api.Trace(context)); await Api.Error(context, 500, "INTERNAL_ERROR", "账号服务暂时无法处理请求"); }
        });
        app.MapGet("/healthz", () => Results.Ok(new { status = "healthy", service = name }));
        app.MapGet("/readyz", async (HttpContext context, AccountDatabase database) =>
        {
            try { await database.Initialize(name == "auth-service" ? "auth" : "users", false, context.RequestAborted); return Results.Ok(new { status = "ready", service = name, storage = "mysql" }); }
            catch (MySqlException) { return Results.Json(new { status = "unavailable", service = name }, statusCode: 503); }
        });
        return app;
    }

    public static string User(HttpContext context)
    {
        var values = context.Request.Headers["X-User-Id"];
        if (values.Count != 1) throw new ApiException(401, "AUTH_REQUIRED", "需要有效登录身份");
        var user = Api.Uuid(values[0]); context.Items["user"] = user; return user;
    }

    public static void AuthCaller(HttpContext context)
    {
        if (context.Request.Headers["X-Caller-Service"].Count != 1 || context.Request.Headers["X-Caller-Service"] != "AuthService")
            throw new ApiException(403, "FORBIDDEN", "仅允许 AuthService 调用");
    }
}
