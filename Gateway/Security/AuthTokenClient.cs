using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;
using SocialAssistant.Gateway.Configuration;
using SocialAssistant.Gateway.Routing;
using SocialAssistant.Gateway.Http;

namespace SocialAssistant.Gateway.Security;

public sealed class AuthTokenClient(IHttpClientFactory clients, IOptions<GatewayOptions> options)
{
    public const string ClientName = "auth-introspection";
    public async Task<IdentityResult> Resolve(HttpContext context, string token)
    {
        var config = options.Value;
        if (!config.AccountAuth.Enabled || !config.Services.TryGetValue(GatewayServiceNames.Auth, out var service) || service.GatewayKey.Length < 32)
            return IdentityResult.Unavailable();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(config.AccountAuth.TimeoutSeconds, 1, 15)));
        using var request = new HttpRequestMessage(HttpMethod.Post, service.BaseUrl.TrimEnd('/') + "/internal/v1/auth/introspections");
        request.Headers.Add("X-Gateway-Key", service.GatewayKey);
        request.Headers.Add("X-Correlation-Id", ApiErrorWriter.GetTraceId(context));
        request.Content = JsonContent.Create(new { token });
        try
        {
            using var response = await clients.CreateClient(ClientName).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode) return IdentityResult.Unavailable();
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var bytes = new byte[1024]; int count;
            while ((count = await stream.ReadAsync(bytes, timeout.Token)) > 0)
            {
                if (buffer.Length + count > 16 * 1024) return IdentityResult.Unavailable();
                buffer.Write(bytes, 0, count);
            }
            using var document = JsonDocument.Parse(buffer.ToArray());
            var root = document.RootElement;
            if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object || !data.TryGetProperty("active", out var active)) return IdentityResult.Unavailable();
            if (active.ValueKind == JsonValueKind.False) return IdentityResult.Unauthorized("AUTH_REQUIRED", "登录状态已失效，请重新登录");
            if (active.ValueKind != JsonValueKind.True || !data.TryGetProperty("userId", out var user) || user.ValueKind != JsonValueKind.String || !ContractUuid.IsValid(user.GetString()!) ||
                !data.TryGetProperty("sessionId", out var session) || session.ValueKind != JsonValueKind.String || !ContractUuid.IsValid(session.GetString()!) ||
                !data.TryGetProperty("expiresAt", out var expiry) || expiry.ValueKind != JsonValueKind.String || !expiry.TryGetDateTimeOffset(out var expiresAt) || expiresAt <= DateTimeOffset.UtcNow)
                return IdentityResult.Unavailable();
            return IdentityResult.Authenticated(Guid.Parse(user.GetString()!), session.GetString());
        }
        catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested) { return IdentityResult.Unavailable(); }
        catch (Exception error) when (error is HttpRequestException or JsonException or IOException) { return IdentityResult.Unavailable(); }
    }
}
