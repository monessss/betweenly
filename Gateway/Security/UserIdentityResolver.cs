using Microsoft.Extensions.Options;
using SocialAssistant.Gateway.Configuration;
using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace SocialAssistant.Gateway.Security;

public sealed class UserIdentityResolver(
    IOptions<GatewayOptions> options,
    IHostEnvironment environment,
    AuthTokenClient tokens)
{
    public const string DevelopmentUserHeader = "X-Dev-User-Id";
    public const string DesktopTokenHeader = "X-Desktop-Token";

    public async Task<IdentityResult> ResolvePublic(HttpContext context)
    {
        var gatewayOptions = options.Value;
        if (gatewayOptions.DesktopAuth.Enabled)
        {
            var desktop = gatewayOptions.DesktopAuth;
            var tokens = context.Request.Headers[DesktopTokenHeader];
            if (context.Connection.RemoteIpAddress is { } address && IPAddress.IsLoopback(address) &&
                desktop.Token.Length >= 32 && tokens.Count == 1 &&
                CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(tokens[0] ?? ""), Encoding.UTF8.GetBytes(desktop.Token)) &&
                Guid.TryParse(desktop.UserId, out var localUser))
                return IdentityResult.Authenticated(localUser);
            return IdentityResult.Unauthorized("AUTH_REQUIRED", "需要本机 Betweenly 桌面身份");
        }
        var authorization = context.Request.Headers.Authorization;
        if (authorization.Count > 0)
        {
            var value = authorization[0] ?? "";
            if (authorization.Count != 1 || !value.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return IdentityResult.Unauthorized("AUTH_REQUIRED", "需要 Bearer 访问令牌");
            var bearer = value[7..];
            if (bearer.Length != 43 || !bearer.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_')) return IdentityResult.Unauthorized("AUTH_REQUIRED", "访问令牌无效");
            return await tokens.Resolve(context, bearer);
        }
        if (gatewayOptions.AccountAuth.Enabled) return IdentityResult.Unauthorized("AUTH_REQUIRED", "请先使用邮箱和密码登录");
        if (!environment.IsDevelopment() || !gatewayOptions.DevelopmentAuth.Enabled)
        {
            return IdentityResult.Unauthorized(
                "AUTH_REQUIRED",
                "请先登录后再使用该功能");
        }

        var values = context.Request.Headers[DevelopmentUserHeader];
        if (values.Count != 1 || !Guid.TryParse(values[0], out var userId))
        {
            return IdentityResult.Unauthorized(
                "AUTH_REQUIRED",
                "开发模式需要提供有效的 X-Dev-User-Id");
        }

        return IdentityResult.Authenticated(userId);
    }
}

public sealed record IdentityResult(
    bool IsAuthenticated,
    Guid UserId,
    string? ErrorCode,
    string? ErrorMessage,
    string? SessionId = null,
    int StatusCode = 401)
{
    public static IdentityResult Authenticated(Guid userId, string? sessionId = null) =>
        new(true, userId, null, null, sessionId);

    public static IdentityResult Unauthorized(string code, string message) =>
        new(false, Guid.Empty, code, message);
    public static IdentityResult Unavailable() => new(false, Guid.Empty, "AUTH_UNAVAILABLE", "认证服务暂不可用，请稍后重试", StatusCode: 503);
}
