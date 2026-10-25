using System.Globalization;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Betweenly.Shared;

public sealed class ApiException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}

public static partial class Api
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static string Now() => DateTimeOffset.UtcNow.ToString("O");
    public static string NewId() => Guid.NewGuid().ToString();
    public static ApiException Invalid(string message = "请求字段不符合契约") => new(400, "VALIDATION_ERROR", message);
    public static ApiException Missing() => new(404, "RESOURCE_NOT_FOUND", "记录不存在或不可访问");
    public static ApiException Business(string message) => new(422, "BUSINESS_RULE_VIOLATION", message);
    public static ApiException Scope() => new(422, "CONTEXT_SCOPE_INVALID", "引用的记录不属于当前联系人或已不可用");
    public static string User(HttpContext c) => c.Items["user"]!.ToString()!;
    public static string Trace(HttpContext c) => c.Items["trace"]!.ToString()!;
    public static string Env(string name, string fallback = "") => Environment.GetEnvironmentVariable(name) ?? fallback;
    [GeneratedRegex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")]
    private static partial Regex UuidPattern();
    public static string Uuid(string? value) => value is not null && UuidPattern().IsMatch(value) ? value : throw Invalid("需要小写 UUID v4");

    public static WebApplication Create(string service, int port)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseSetting("urls", Env("ASPNETCORE_URLS", $"http://127.0.0.1:{port}"));
        builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 1024 * 1024);
        builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
        builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);
        var key = Env("GATEWAY_KEY");
        if (string.IsNullOrWhiteSpace(key)) throw new InvalidOperationException("GATEWAY_KEY is required.");
        var app = builder.Build();
        app.Use(async (c, next) =>
        {
            var suppliedTrace = c.Request.Headers["X-Correlation-Id"].ToString();
            c.Items["trace"] = suppliedTrace.Length is > 0 and <= 128 ? suppliedTrace : NewId();
            c.Response.Headers["X-Correlation-Id"] = Trace(c);
            c.Response.Headers.CacheControl = "no-store";
            try
            {
                if (c.Request.Path != "/healthz" && c.Request.Path != "/readyz")
                {
                    var supplied = c.Request.Headers["X-Gateway-Key"];
                    if (supplied.Count != 1 || !SecureEquals(key, supplied[0] ?? ""))
                        throw new ApiException(403, "FORBIDDEN", "缺少有效的 Gateway 身份");
                    var user = c.Request.Headers["X-User-Id"];
                    if (user.Count != 1) throw new ApiException(403, "FORBIDDEN", "缺少可信用户身份");
                    c.Items["user"] = Uuid(user[0]);
                }
                await next(c);
            }
            catch (ApiException e) { await Error(c, e.Status, e.Code, e.Message); }
            catch (Exception e) when (e is JsonException or FormatException or InvalidOperationException or BadHttpRequestException)
            {
                if (e is BadHttpRequestException { StatusCode: 413 }) await Error(c, 413, "INPUT_TOO_LARGE", "请求过大");
                else if (e is InvalidOperationException) { app.Logger.LogError("Service operation failed; trace={Trace}", Trace(c)); await Error(c, 500, "INTERNAL_ERROR", "服务暂时无法处理请求"); }
                else await Error(c, 400, "VALIDATION_ERROR", "JSON 或请求格式无效");
            }
            catch (OperationCanceledException) when (c.RequestAborted.IsCancellationRequested) { }
            catch (Exception) { app.Logger.LogError("Unhandled service failure; trace={Trace}", Trace(c)); await Error(c, 500, "INTERNAL_ERROR", "服务暂时无法处理请求"); }
        });
        app.MapGet("/healthz", () => Results.Ok(new { status = "healthy", service }));
        return app;
    }

    private static bool SecureEquals(string a, string b) => CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
    public static Task Error(HttpContext c, int status, string code, string message)
    {
        if (c.Response.HasStarted) { c.Abort(); return Task.CompletedTask; }
        c.Response.StatusCode = status;
        return c.Response.WriteAsJsonAsync(new { data = (object?)null, error = new { code, message, details = new { } }, traceId = Trace(c) });
    }
    public static IResult Ok(HttpContext c, JsonNode? data, int status = 200, object? meta = null)
    {
        if (data is JsonObject obj && obj["version"] is not null) c.Response.Headers.ETag = $"\"{obj["version"]}\"";
        return Results.Json(new { data, meta = meta ?? new { }, traceId = Trace(c) }, statusCode: status);
    }
    public static async Task<JsonObject> Body(HttpContext c)
    {
        if (!c.Request.HasJsonContentType()) throw Invalid("Content-Type 必须是 application/json");
        using var document = await JsonDocument.ParseAsync(c.Request.Body, cancellationToken: c.RequestAborted);
        void Unique(JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                var keys = new HashSet<string>(StringComparer.Ordinal);
                foreach (var property in element.EnumerateObject()) { if (!keys.Add(property.Name)) throw Invalid("JSON 字段不得重复"); Unique(property.Value); }
            }
            else if (element.ValueKind == JsonValueKind.Array) foreach (var item in element.EnumerateArray()) Unique(item);
        }
        Unique(document.RootElement);
        return JsonNode.Parse(document.RootElement.GetRawText()) as JsonObject ?? throw Invalid();
    }
    public static void Match(HttpContext c, JsonObject value)
    {
        var raw = c.Request.Headers.IfMatch.ToString().Trim('"');
        if (!int.TryParse(raw, out var version) || version != value["version"]!.GetValue<int>())
            throw new ApiException(409, "VERSION_CONFLICT", "记录已变更，请刷新后重试");
    }
    public static JsonObject Stamp(JsonObject input, string idName, string id, string? contact = null)
    {
        var value = (JsonObject)input.DeepClone();
        value[idName] = id; if (contact is not null) value["contactId"] = contact;
        value["version"] = 1; value["createdAt"] = Now(); value["updatedAt"] = Now(); return value;
    }
    public static JsonObject Update(JsonObject old, JsonObject input)
    {
        var value = (JsonObject)old.DeepClone();
        foreach (var pair in input) value[pair.Key] = pair.Value?.DeepClone();
        value["version"] = old["version"]!.GetValue<int>() + 1; value["updatedAt"] = Now(); return value;
    }
    public static IResult Page(HttpContext c, IEnumerable<JsonObject> source)
    {
        if (c.Request.Query.Keys.Any(k => k is not ("cursor" or "limit"))) throw Invalid("不支持的查询参数");
        var limitText = c.Request.Query["limit"].ToString();
        var limit = limitText == "" ? 100 : int.TryParse(limitText, out var parsed) && parsed is > 0 and <= 100 ? parsed : throw Invalid("limit 必须为 1 至 100");
        var cursor = c.Request.Query["cursor"].ToString(); var offset = 0;
        if (cursor != "")
        {
            try { var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(cursor)); if (!decoded.StartsWith("v1:") || !int.TryParse(decoded[3..], out offset) || offset < 0) throw Invalid("分页游标无效"); }
            catch (FormatException) { throw Invalid("分页游标无效"); }
        }
        var items = source.ToArray();
        var values = new JsonArray(items.Skip(offset).Take(limit).Select(v => (JsonNode?)v.DeepClone()).ToArray());
        var next = offset + limit < items.Length ? Convert.ToBase64String(Encoding.UTF8.GetBytes($"v1:{offset + limit}")) : null;
        return Ok(c, values, meta: new { nextCursor = next });
    }
    public static string Hash(JsonNode input) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(input))));
    private static string Canonical(JsonNode? node) => node switch
    {
        JsonObject o => "{" + string.Join(",", o.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => JsonSerializer.Serialize(p.Key) + ":" + Canonical(p.Value))) + "}",
        JsonArray a => "[" + string.Join(",", a.Select(Canonical)) + "]",
        null => "null", _ => node.ToJsonString()
    };
}

// Cross-service calls always go through the Gateway; credentials never reach the browser.
public sealed class InternalClient(string service, string credential) : IDisposable
{
    private readonly HttpClient client = new(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false })
    { BaseAddress = new Uri(Api.Env("INTERNAL_GATEWAY_URL", "http://127.0.0.1:5080")), Timeout = TimeSpan.FromSeconds(80) };
    public async Task<JsonNode?> Send(HttpContext context, HttpMethod method, string path, JsonNode? body = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Add("X-Service-Name", service); request.Headers.Add("X-Service-Key", credential);
        request.Headers.Add("X-Acting-User-Id", Api.User(context)); request.Headers.Add("X-Correlation-Id", Api.Trace(context));
        if (body is not null) request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        try
        {
            using var response = await client.SendAsync(request, context.RequestAborted);
            if (response.StatusCode == System.Net.HttpStatusCode.NoContent) return null;
            var json = await response.Content.ReadFromJsonAsync<JsonObject>(cancellationToken: context.RequestAborted);
            if (!response.IsSuccessStatusCode)
                throw new ApiException((int)response.StatusCode, json?["error"]?["code"]?.GetValue<string>() ?? "SERVICE_UNAVAILABLE", json?["error"]?["message"]?.GetValue<string>() ?? "依赖服务不可用");
            if (json is null || !json.ContainsKey("data")) throw new ApiException(503, "SERVICE_UNAVAILABLE", "依赖服务响应无效");
            return json["data"]?.DeepClone();
        }
        catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested) { throw new ApiException(504, path.EndsWith("/analysis") ? "MODEL_TIMEOUT" : "GATEWAY_TIMEOUT", "依赖服务响应超时"); }
        catch (HttpRequestException) { throw new ApiException(503, "SERVICE_UNAVAILABLE", "依赖服务连接失败"); }
        catch (JsonException) { throw new ApiException(path.EndsWith("/analysis") ? 502 : 503, path.EndsWith("/analysis") ? "MODEL_OUTPUT_INVALID" : "SERVICE_UNAVAILABLE", "依赖服务响应格式无效"); }
    }
    public void Dispose() => client.Dispose();
}
