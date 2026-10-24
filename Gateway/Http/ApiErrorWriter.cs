using System.Text.Json;

namespace SocialAssistant.Gateway.Http;

public static class ApiErrorWriter
{
    public const string CorrelationHeader = "X-Correlation-Id";
    private static readonly object TraceIdKey = new();
    internal static IReadOnlyList<string> ProtocolHeaders { get; } =
        ["Allow", "Retry-After", "WWW-Authenticate"];

    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web);

    public static string GetTraceId(HttpContext context)
    {
        if (context.Items.TryGetValue(TraceIdKey, out var cached) && cached is string traceId)
        {
            return traceId;
        }

        var requestValues = context.Request.Headers[CorrelationHeader];
        var requested = requestValues.Count == 1 ? requestValues[0] : null;
        var normalized = !string.IsNullOrWhiteSpace(requested) &&
            requested.Length <= 128 &&
            requested.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.')
                ? requested
                : Guid.NewGuid().ToString("N");
        context.Items[TraceIdKey] = normalized;
        return normalized;
    }

    public static async Task WriteAsync(
        HttpContext context,
        int statusCode,
        string code,
        string message,
        IReadOnlyDictionary<string, object?>? details = null)
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        var traceId = GetTraceId(context);
        var protocolHeaders = ProtocolHeaders
            .Where(name => context.Response.Headers.ContainsKey(name))
            .ToDictionary(name => name, name => context.Response.Headers[name]);
        context.Response.Clear();
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers[CorrelationHeader] = traceId;
        foreach (var header in protocolHeaders)
        {
            context.Response.Headers[header.Key] = header.Value;
        }

        var body = new
        {
            data = (object?)null,
            error = new
            {
                code,
                message,
                details = details ?? new Dictionary<string, object?>()
            },
            traceId
        };

        await JsonSerializer.SerializeAsync(
            context.Response.Body,
            body,
            JsonOptions,
            context.RequestAborted);
    }
}
