using SocialAssistant.Gateway.Http;
using SocialAssistant.Gateway.Routing;
using SocialAssistant.Gateway.Security;
using Microsoft.Extensions.Options;
using SocialAssistant.Gateway.Configuration;

namespace SocialAssistant.Gateway.Proxy;

public sealed class GatewayMiddleware(
    RouteCatalog routes,
    UserIdentityResolver publicIdentity,
    ServiceCredentialValidator serviceIdentity,
    GatewayProxy proxy,
    IOptions<GatewayOptions> options,
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
        if (!options.Value.AccountAuth.Enabled && route.Service is GatewayServiceNames.Auth or GatewayServiceNames.User)
        {
            await ApiErrorWriter.WriteAsync(context, 404, "RESOURCE_NOT_FOUND", "账号服务未启用"); return;
        }
        context.Response.Headers.CacheControl = "no-store";
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
            context.Items["callerService"] = identity.ServiceName;
        }
        else if (route.AllowAnonymous) userId = Guid.Empty;
        else
        {
            var identity = await publicIdentity.ResolvePublic(context);
            if (!identity.IsAuthenticated)
            {
                await ApiErrorWriter.WriteAsync(
                    context,
                    identity.StatusCode,
                    identity.ErrorCode ?? "AUTH_REQUIRED",
                    identity.ErrorMessage ?? "请先登录");
                return;
            }

            userId = identity.UserId;
            if (identity.SessionId is not null) context.Items["sessionId"] = identity.SessionId;
        }

        if (route.Name is "wechat-import-status" or "wechat-import-preview" or "wechat-import-commit")
        {
            // Loopback alone is insufficient: Vite/FRP can proxy remote clients
            // through localhost. Only the authenticated desktop broker may call
            // the server machine's UI automation helper.
            var desktop = options.Value.DesktopAuth;
            if (!desktop.Enabled || desktop.WeChatImportToken.Length < 32)
            {
                const string message = "网页端不支持读取微信，请使用批量粘贴导入，或在自己的电脑上使用 Betweenly 桌面版。";
                if (route.Name == "wechat-import-status")
                {
                    await context.Response.WriteAsJsonAsync(new { data = new { available = false, version = (string?)null, method = "WINDOWS_LOCAL_TEXT", message }, meta = new { }, traceId });
                }
                else await ApiErrorWriter.WriteAsync(context, 403, "WECHAT_LOCAL_ONLY", message);
                return;
            }
            context.Items["wechatImportToken"] = desktop.WeChatImportToken;
        }
        await proxy.ForwardAsync(context, route, userId, traceId);
    }
}
