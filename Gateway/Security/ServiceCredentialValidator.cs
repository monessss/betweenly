using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using SocialAssistant.Gateway.Configuration;
using SocialAssistant.Gateway.Routing;

namespace SocialAssistant.Gateway.Security;

public sealed class ServiceCredentialValidator(IOptions<GatewayOptions> options)
{
    public const string ServiceNameHeader = "X-Service-Name";
    public const string ServiceKeyHeader = "X-Service-Key";
    public const string ActingUserHeader = "X-Acting-User-Id";

    public ServiceIdentityResult Validate(HttpContext context, GatewayRoute route)
    {
        if (!TryReadSingleHeader(context, ServiceNameHeader, out var serviceName))
        {
            return ServiceIdentityResult.Forbidden(
                "SERVICE_IDENTITY_INVALID",
                "缺少唯一的服务身份");
        }

        if (!TryReadSingleHeader(context, ServiceKeyHeader, out var serviceKey))
        {
            return ServiceIdentityResult.Forbidden(
                "SERVICE_IDENTITY_INVALID",
                "缺少唯一的服务密钥");
        }

        if (!route.AllowedCallers.Contains(serviceName))
        {
            return ServiceIdentityResult.Forbidden(
                "SERVICE_ROUTE_FORBIDDEN",
                "当前服务无权调用该内部接口");
        }

        if (!options.Value.ServiceCredentials.TryGetValue(serviceName, out var expectedKey) ||
            string.IsNullOrWhiteSpace(expectedKey) ||
            !FixedTimeEquals(serviceKey, expectedKey))
        {
            return ServiceIdentityResult.Forbidden(
                "SERVICE_IDENTITY_INVALID",
                "服务身份校验失败");
        }

        if (!TryReadSingleHeader(context, ActingUserHeader, out var actingUser) ||
            !Guid.TryParse(actingUser, out var userId))
        {
            return ServiceIdentityResult.BadRequest(
                "VALIDATION_ERROR",
                "用户作用域内部接口需要有效的 X-Acting-User-Id");
        }

        return ServiceIdentityResult.Authenticated(serviceName, userId);
    }

    private static bool TryReadSingleHeader(
        HttpContext context,
        string name,
        out string value)
    {
        var values = context.Request.Headers[name];
        if (values.Count == 1 && !string.IsNullOrWhiteSpace(values[0]))
        {
            value = values[0]!;
            return true;
        }

        value = string.Empty;
        return false;
    }

    private static bool FixedTimeEquals(string provided, string expected)
    {
        var providedBytes = Encoding.UTF8.GetBytes(provided);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        return providedBytes.Length == expectedBytes.Length &&
            CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes);
    }
}

public sealed record ServiceIdentityResult(
    bool IsAuthenticated,
    string? ServiceName,
    Guid UserId,
    int? StatusCode,
    string? ErrorCode,
    string? ErrorMessage)
{
    public static ServiceIdentityResult Authenticated(string serviceName, Guid userId) =>
        new(true, serviceName, userId, null, null, null);

    public static ServiceIdentityResult Forbidden(string code, string message) =>
        new(false, null, Guid.Empty, StatusCodes.Status403Forbidden, code, message);

    public static ServiceIdentityResult BadRequest(string code, string message) =>
        new(false, null, Guid.Empty, StatusCodes.Status400BadRequest, code, message);
}
