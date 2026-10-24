using SocialAssistant.Gateway.Http;
using SocialAssistant.Gateway.Routing;
using SocialAssistant.Gateway.Security;

namespace SocialAssistant.Gateway.Proxy;

public sealed class GatewayMiddleware(
    RouteCatalog routes,
    UserIdentityResolver publicIdentity,
    ServiceCredentialValidator serviceIdentity,
    GatewayProxy proxy,
    RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var traceId = ApiErrorWriter.GetTraceId(context);
        context.Response.Headers[ApiErrorWriter.CorrelationHeader] = traceId;
        var path = context.Request.Path.Value ?? string.Empty;
        if (!path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) &&
            !path.StartsWith("/internal/", StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        var routeMatch = routes.Match(context.Request.Method, path);
        if (routeMatch.Kind == RouteMatchKind.InvalidParameters)
        {
            await ApiErrorWriter.WriteAsync(
                context,
                StatusCodes.Status400BadRequest,
                "VALIDATION_ERROR",
                "路径参数必须为小写 UUID v4");
            return;
        }

        if (routeMatch.Kind == RouteMatchKind.NotFound)
        {
            await ApiErrorWriter.WriteAsync(
                context,
                StatusCodes.Status404NotFound,
                "RESOURCE_NOT_FOUND",
                "请求的路由不存在");
            return;
        }

        if (routeMatch.Kind == RouteMatchKind.MethodNotAllowed)
        {
            context.Response.Headers.Allow = string.Join(", ", routeMatch.AllowedMethods);
            await ApiErrorWriter.WriteAsync(
                context,
                StatusCodes.Status405MethodNotAllowed,
                "METHOD_NOT_ALLOWED",
                "请求方法不受支持");
            return;
        }

        var route = routeMatch.Route!;
        Guid userId;
        if (route.IsInternal)
        {
            var identity = serviceIdentity.Validate(context, route);
            if (!identity.IsAuthenticated)
            {
                await ApiErrorWriter.WriteAsync(
                    context,
                    identity.StatusCode ?? StatusCodes.Status403Forbidden,
                    identity.ErrorCode ?? "SERVICE_IDENTITY_INVALID",
                    identity.ErrorMessage ?? "服务身份校验失败");
                return;
            }

            userId = identity.UserId;
        }
        else
        {
            var identity = publicIdentity.ResolvePublic(context);
            if (!identity.IsAuthenticated)
            {
                await ApiErrorWriter.WriteAsync(
                    context,
                    StatusCodes.Status401Unauthorized,
                    identity.ErrorCode ?? "AUTH_REQUIRED",
                    identity.ErrorMessage ?? "请先登录");
                return;
            }

            userId = identity.UserId;
        }

        await proxy.ForwardAsync(context, route, userId, traceId);
    }
}
