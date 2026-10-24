using System.Text.Json;
using Microsoft.Extensions.Options;
using SocialAssistant.Gateway.Configuration;
using SocialAssistant.Gateway.Http;
using SocialAssistant.Gateway.Routing;
using SocialAssistant.Gateway.Security;

namespace SocialAssistant.Gateway.Proxy;

public sealed class GatewayProxy(
    IHttpClientFactory httpClientFactory,
    IOptions<GatewayOptions> options)
{
    public const string ClientName = "downstream";

    private static readonly HashSet<string> HopByHopHeaders =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "Connection",
            "Keep-Alive",
            "Proxy-Authenticate",
            "Proxy-Authorization",
            "TE",
            "Trailer",
            "Transfer-Encoding",
            "Upgrade"
        };

    private static readonly HashSet<string> TrustHeaders =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "Host",
            "Content-Length",
            "Authorization",
            ApiErrorWriter.CorrelationHeader,
            UserIdentityResolver.DevelopmentUserHeader,
            ServiceCredentialValidator.ServiceNameHeader,
            ServiceCredentialValidator.ServiceKeyHeader,
            ServiceCredentialValidator.ActingUserHeader,
            "X-User-Id",
            "X-Gateway-Key"
        };

    private static readonly HashSet<string> ContentHeaders =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "Content-Type",
            "Content-Encoding",
            "Content-Language",
            "Content-Location",
            "Content-Range",
            "Content-MD5",
            "Content-Disposition"
        };

    public async Task ForwardAsync(
        HttpContext context,
        GatewayRoute route,
        Guid userId,
        string traceId)
    {
        var gatewayOptions = options.Value;
        var isAnalysis = route.Service == GatewayServiceNames.Analysis;
        if (!gatewayOptions.Services.TryGetValue(route.Service, out var target))
        {
            await ApiErrorWriter.WriteAsync(
                context,
                StatusCodes.Status503ServiceUnavailable,
                isAnalysis ? "MODEL_UNAVAILABLE" : "SERVICE_UNAVAILABLE",
                "目标服务尚未配置");
            return;
        }

        var targetUri = BuildTargetUri(target.BaseUrl, context.Request.Path, context.Request.QueryString);
        using var message = new HttpRequestMessage(new HttpMethod(context.Request.Method), targetUri);
        CopyRequestHeaders(context, message);

        if (ShouldForwardBody(context.Request))
        {
            message.Content = new StreamContent(context.Request.Body);
        }

        CopyContentHeaders(context, message);
        message.Headers.TryAddWithoutValidation(ApiErrorWriter.CorrelationHeader, traceId);
        message.Headers.TryAddWithoutValidation("X-User-Id", userId.ToString());
        message.Headers.TryAddWithoutValidation("X-Gateway-Key", target.GatewayKey);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, gatewayOptions.RequestTimeoutSeconds)));

        try
        {
            var client = httpClientFactory.CreateClient(ClientName);
            using var response = await client.SendAsync(
                message,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);

            if ((int)response.StatusCode is >= 300 and < 400)
            {
                await ApiErrorWriter.WriteAsync(
                    context,
                    StatusCodes.Status503ServiceUnavailable,
                    isAnalysis ? "MODEL_UNAVAILABLE" : "SERVICE_UNAVAILABLE",
                    "目标服务返回了不受支持的重定向");
                return;
            }

            if ((int)response.StatusCode >= 400)
            {
                await WriteDownstreamErrorAsync(context, response, isAnalysis, timeout.Token);
                return;
            }

            context.Response.StatusCode = (int)response.StatusCode;
            CopyResponseHeaders(response, context);
            await response.Content.CopyToAsync(context.Response.Body, timeout.Token);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // The client disconnected; no response body can be written.
        }
        catch (OperationCanceledException)
        {
            await FailOrAbortAsync(
                context,
                StatusCodes.Status504GatewayTimeout,
                isAnalysis ? "MODEL_TIMEOUT" : "GATEWAY_TIMEOUT",
                "上游服务响应超时");
        }
        catch (HttpRequestException)
        {
            await FailOrAbortAsync(
                context,
                StatusCodes.Status503ServiceUnavailable,
                isAnalysis ? "MODEL_UNAVAILABLE" : "SERVICE_UNAVAILABLE",
                "上游服务暂时不可用");
        }
        catch (IOException)
        {
            await FailOrAbortAsync(
                context,
                StatusCodes.Status503ServiceUnavailable,
                isAnalysis ? "MODEL_UNAVAILABLE" : "SERVICE_UNAVAILABLE",
                "上游服务连接中断");
        }
    }

    private static Task FailOrAbortAsync(
        HttpContext context,
        int statusCode,
        string code,
        string message)
    {
        if (context.Response.HasStarted)
        {
            // A partial success body cannot be followed by a JSON error envelope.
            context.Abort();
            return Task.CompletedTask;
        }

        return ApiErrorWriter.WriteAsync(context, statusCode, code, message);
    }

    private static async Task WriteDownstreamErrorAsync(
        HttpContext context,
        HttpResponseMessage response,
        bool isAnalysis,
        CancellationToken cancellationToken)
    {
        // Bound diagnostic reads so an invalid/large upstream error cannot exhaust memory.
        CopyErrorHeaders(response, context);
        const int maxErrorBytes = 64 * 1024;
        var buffer = new byte[maxErrorBytes + 1];
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var count = 0;
        while (count < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(count), cancellationToken);
            if (read == 0)
            {
                break;
            }

            count += read;
        }

        if (count <= maxErrorBytes)
        {
            try
            {
                using var document = JsonDocument.Parse(buffer.AsMemory(0, count));
                var root = document.RootElement;
                if (root.ValueKind == JsonValueKind.Object &&
                    root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Null &&
                    root.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.Object &&
                    error.TryGetProperty("code", out var code) && code.ValueKind == JsonValueKind.String &&
                    !string.IsNullOrWhiteSpace(code.GetString()) &&
                    error.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.String &&
                    error.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Object)
                {
                    await ApiErrorWriter.WriteAsync(
                        context,
                        (int)response.StatusCode,
                        code.GetString()!,
                        message.GetString()!,
                        details.Deserialize<Dictionary<string, object?>>());
                    return;
                }
            }
            catch (JsonException)
            {
                // Framework error pages and malformed JSON are replaced below.
            }
        }

        var status = (int)response.StatusCode;
        var fallbackCode = status switch
        {
            400 => "VALIDATION_ERROR",
            401 => "AUTH_REQUIRED",
            403 => "FORBIDDEN",
            404 => "RESOURCE_NOT_FOUND",
            405 => "METHOD_NOT_ALLOWED",
            413 => "INPUT_TOO_LARGE",
            422 => "BUSINESS_RULE_VIOLATION",
            429 => "RATE_LIMITED",
            502 when isAnalysis => "MODEL_OUTPUT_INVALID",
            503 => isAnalysis ? "MODEL_UNAVAILABLE" : "SERVICE_UNAVAILABLE",
            504 => isAnalysis ? "MODEL_TIMEOUT" : "GATEWAY_TIMEOUT",
            _ => "INTERNAL_ERROR"
        };
        await ApiErrorWriter.WriteAsync(context, status, fallbackCode, "目标服务未能完成该请求");
    }

    private static void CopyErrorHeaders(HttpResponseMessage source, HttpContext context)
    {
        foreach (var name in ApiErrorWriter.ProtocolHeaders)
        {
            if (source.Headers.TryGetValues(name, out var values) ||
                source.Content.Headers.TryGetValues(name, out values))
            {
                context.Response.Headers[name] = values.ToArray();
            }
        }
    }

    private static void CopyRequestHeaders(HttpContext context, HttpRequestMessage message)
    {
        foreach (var header in context.Request.Headers)
        {
            if (HopByHopHeaders.Contains(header.Key) || TrustHeaders.Contains(header.Key))
            {
                continue;
            }

            if (!message.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()))
            {
                // Content headers are copied after the content object is created.
            }
        }
    }

    private static void CopyContentHeaders(HttpContext context, HttpRequestMessage message)
    {
        if (message.Content is null)
        {
            return;
        }

        foreach (var header in context.Request.Headers)
        {
            if (ContentHeaders.Contains(header.Key))
            {
                message.Content.Headers.TryAddWithoutValidation(
                    header.Key,
                    header.Value.ToArray());
            }
        }
    }

    private static void CopyResponseHeaders(
        HttpResponseMessage source,
        HttpContext context)
    {
        foreach (var header in source.Headers)
        {
            if (!HopByHopHeaders.Contains(header.Key))
            {
                context.Response.Headers[header.Key] = header.Value.ToArray();
            }
        }

        foreach (var header in source.Content.Headers)
        {
            if (!HopByHopHeaders.Contains(header.Key) &&
                !string.Equals(header.Key, "Content-Length", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.Headers[header.Key] = header.Value.ToArray();
            }
        }

        context.Response.Headers.Remove("transfer-encoding");
        context.Response.Headers[ApiErrorWriter.CorrelationHeader] = ApiErrorWriter.GetTraceId(context);
    }

    private static bool ShouldForwardBody(HttpRequest request) =>
        request.ContentLength is > 0 ||
        request.Headers.ContainsKey("Transfer-Encoding") ||
        HttpMethods.IsPost(request.Method) ||
        HttpMethods.IsPut(request.Method) ||
        HttpMethods.IsPatch(request.Method);

    private static Uri BuildTargetUri(string baseUrl, PathString path, QueryString query)
    {
        var baseUri = new Uri(baseUrl.TrimEnd('/') + "/", UriKind.Absolute);
        return new Uri(baseUri, path.Value!.TrimStart('/') + query.Value);
    }
}
