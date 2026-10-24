using Microsoft.Extensions.Options;
using SocialAssistant.Gateway.Configuration;

namespace SocialAssistant.Gateway.Security;

public sealed class UserIdentityResolver(
    IOptions<GatewayOptions> options,
    IHostEnvironment environment)
{
    public const string DevelopmentUserHeader = "X-Dev-User-Id";

    public IdentityResult ResolvePublic(HttpContext context)
    {
        var gatewayOptions = options.Value;
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
    string? ErrorMessage)
{
    public static IdentityResult Authenticated(Guid userId) =>
        new(true, userId, null, null);

    public static IdentityResult Unauthorized(string code, string message) =>
        new(false, Guid.Empty, code, message);
}
