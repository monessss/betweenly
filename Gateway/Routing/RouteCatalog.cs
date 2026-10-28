namespace SocialAssistant.Gateway.Routing;

public sealed class RouteCatalog
{
    // Match path structure first; malformed IDs must produce 400 rather than 404.
    private const string Uuid = "[^/]+";

    private static readonly string[] Read = ["GET"];
    private static readonly string[] ReadCreate = ["GET", "POST"];
    private static readonly string[] ReadUpdateDelete = ["GET", "PATCH", "DELETE"];
    private static readonly string[] PatchDelete = ["PATCH", "DELETE"];
    private static readonly string[] Delete = ["DELETE"];

    private readonly IReadOnlyList<GatewayRoute> _routes = BuildRoutes();

    public RouteMatch Match(string method, string path)
    {
        var matchingPaths = _routes
            .Where(route => route.PathPattern.IsMatch(path))
            .ToArray();

        if (matchingPaths.Length == 0)
        {
            return RouteMatch.NotFound();
        }

        var matched = matchingPaths.FirstOrDefault(route => route.AllowsMethod(method));
        return matched is null
            ? RouteMatch.MethodNotAllowed(
                matchingPaths.SelectMany(route => route.Methods).Distinct().ToArray())
            : matched.HasValidParameters(path)
                ? RouteMatch.Found(matched)
                : RouteMatch.InvalidParameters();
    }

    public IReadOnlyList<GatewayRoute> All => _routes;

    private static IReadOnlyList<GatewayRoute> BuildRoutes() =>
    [
        new("auth-registration", @"^/api/v1/auth/registrations/?$", GatewayServiceNames.Auth, ["POST"], allowAnonymous: true),
        new("auth-registration-code", @"^/api/v1/auth/registration-codes/?$", GatewayServiceNames.Auth, ["POST"], allowAnonymous: true),
        new("auth-password-reset-code", @"^/api/v1/auth/password-reset-codes/?$", GatewayServiceNames.Auth, ["POST"], allowAnonymous: true),
        new("auth-password-reset", @"^/api/v1/auth/password-resets/?$", GatewayServiceNames.Auth, ["POST"], allowAnonymous: true),
        new("auth-email-verification-request", @"^/api/v1/auth/email-verification-requests/?$", GatewayServiceNames.Auth, ["POST"]),
        new("auth-email-verification", @"^/api/v1/auth/email-verifications/?$", GatewayServiceNames.Auth, ["POST"]),
        new("auth-login", @"^/api/v1/auth/sessions/?$", GatewayServiceNames.Auth, ["POST"], allowAnonymous: true),
        new("auth-refresh", @"^/api/v1/auth/tokens/?$", GatewayServiceNames.Auth, ["POST"], allowAnonymous: true),
        new("auth-sessions", @"^/api/v1/auth/sessions/?$", GatewayServiceNames.Auth, ["GET"]),
        new("auth-session-revoke", $@"^/api/v1/auth/sessions/(?<sessionId>{Uuid})/?$", GatewayServiceNames.Auth, ["DELETE"]),
        new("auth-account", @"^/api/v1/auth/account/?$", GatewayServiceNames.Auth, ["GET"]),
        new("auth-logout", @"^/api/v1/auth/logout/?$", GatewayServiceNames.Auth, ["POST"]),
        new("auth-password", @"^/api/v1/auth/password/?$", GatewayServiceNames.Auth, ["PUT"]),
        new("admin-users", @"^/api/v1/admin/users/?$", GatewayServiceNames.Auth, ["GET"]),
        new("admin-user", $@"^/api/v1/admin/users/(?<userId>{Uuid})/?$", GatewayServiceNames.Auth, ["GET", "DELETE"]),
        new("admin-user-password", $@"^/api/v1/admin/users/(?<userId>{Uuid})/password/?$", GatewayServiceNames.Auth, ["PUT"]),
        new("admin-user-ban", $@"^/api/v1/admin/users/(?<userId>{Uuid})/ban/?$", GatewayServiceNames.Auth, ["PUT", "DELETE"]),
        new("user-me", @"^/api/v1/users/me/?$", GatewayServiceNames.User, ["GET", "PATCH"]),
        new("internal-user-provision", @"^/internal/v1/users/?$", GatewayServiceNames.User, ["POST"], isInternal: true, allowedCallers: [CallerServiceNames.Auth]),
        new("model-credentials", @"^/api/v1/me/model-credentials/?$", GatewayServiceNames.Analysis, ["GET", "PATCH"]),
        new("voice-corpus", @"^/api/v1/me/voice-corpus/?$", GatewayServiceNames.ExpressionStyle, ["GET", "DELETE"]),
        new("voice-samples", @"^/api/v1/me/voice-corpus/samples/?$", GatewayServiceNames.ExpressionStyle, Read),
        new("voice-import", @"^/api/v1/me/voice-corpus/imports/?$", GatewayServiceNames.ExpressionStyle, ["POST"]),
        new("voice-sample", $@"^/api/v1/me/voice-corpus/samples/(?<sampleId>{Uuid})/?$", GatewayServiceNames.ExpressionStyle, ["PUT", "DELETE"]),
        new("internal-voice-status", $@"^/internal/v1/users/(?<userId>{Uuid})/voice-corpus/?$", GatewayServiceNames.ExpressionStyle, Read, isInternal: true, allowedCallers: [CallerServiceNames.Advice]),
        new("internal-voice-query", @"^/internal/v1/voice-queries/?$", GatewayServiceNames.ExpressionStyle, ["POST"], isInternal: true, allowedCallers: [CallerServiceNames.Advice]),
        new("contact-writing-style", $@"^/api/v1/contacts/(?<contactId>{Uuid})/writing-style/?$", GatewayServiceNames.ContactContext, Read),
        new("text-import-commit", $@"^/api/v1/contacts/(?<contactId>{Uuid})/text-imports/?$", GatewayServiceNames.ContactContext, ["POST"]),
        new("wechat-import-status", @"^/api/v1/wechat-import/status/?$", GatewayServiceNames.ContactContext, Read),
        new("wechat-import-preview", $@"^/api/v1/contacts/(?<contactId>{Uuid})/wechat-imports/preview/?$", GatewayServiceNames.ContactContext, ["POST"]),
        new("wechat-import-commit", $@"^/api/v1/contacts/(?<contactId>{Uuid})/wechat-imports/?$", GatewayServiceNames.ContactContext, ["POST"]),
        new(
            "expression-style-read",
            @"^/api/v1/me/expression-style/?$",
            GatewayServiceNames.ExpressionStyle,
            Read),
        new(
            "expression-style-replace",
            @"^/api/v1/me/expression-style/?$",
            GatewayServiceNames.ExpressionStyle,
            ["PUT"]),
        new(
            "expression-style-delete",
            @"^/api/v1/me/expression-style/?$",
            GatewayServiceNames.ExpressionStyle,
            Delete),
        new(
            "contacts-list-create",
            @"^/api/v1/contacts/?$",
            GatewayServiceNames.ContactContext,
            ReadCreate),
        new(
            "contact",
            $@"^/api/v1/contacts/(?<contactId>{Uuid})/?$",
            GatewayServiceNames.ContactContext,
            ReadUpdateDelete),
        new(
            "contact-messages",
            $@"^/api/v1/contacts/(?<contactId>{Uuid})/messages/?$",
            GatewayServiceNames.ContactContext,
            ReadCreate),
        new(
            "message",
            $@"^/api/v1/messages/(?<messageId>{Uuid})/?$",
            GatewayServiceNames.ContactContext,
            PatchDelete),
        new(
            "contact-events",
            $@"^/api/v1/contacts/(?<contactId>{Uuid})/events/?$",
            GatewayServiceNames.ContactContext,
            ReadCreate),
        new(
            "event",
            $@"^/api/v1/events/(?<eventId>{Uuid})/?$",
            GatewayServiceNames.ContactContext,
            PatchDelete),
        new(
            "contact-preferences",
            $@"^/api/v1/contacts/(?<contactId>{Uuid})/preference-records/?$",
            GatewayServiceNames.ContactContext,
            ReadCreate),
        new(
            "preference",
            $@"^/api/v1/preference-records/(?<recordId>{Uuid})/?$",
            GatewayServiceNames.ContactContext,
            PatchDelete),
        new(
            "contact-advice-list-create",
            $@"^/api/v1/contacts/(?<contactId>{Uuid})/advice-requests/?$",
            GatewayServiceNames.Advice,
            ReadCreate),
        new(
            "advice-read-delete",
            $@"^/api/v1/advice-requests/(?<requestId>{Uuid})/?$",
            GatewayServiceNames.Advice,
            ["GET", "DELETE"]),
        new(
            "advice-feedback",
            $@"^/api/v1/advice-requests/(?<requestId>{Uuid})/feedback/?$",
            GatewayServiceNames.Advice,
            ["POST"]),
        new(
            "advice-outcome",
            $@"^/api/v1/advice-requests/(?<requestId>{Uuid})/outcomes/?$",
            GatewayServiceNames.Advice,
            ["POST"]),
        new(
            "context-data-delete",
            @"^/api/v1/me/context-data/?$",
            GatewayServiceNames.ContactContext,
            Delete),
        new(
            "internal-expression-style",
            $@"^/internal/v1/users/(?<userId>{Uuid})/expression-style/?$",
            GatewayServiceNames.ExpressionStyle,
            Read,
            isInternal: true,
            allowedCallers: [CallerServiceNames.Advice]),
        new(
            "internal-context-query",
            @"^/internal/v1/context-queries/?$",
            GatewayServiceNames.ContactContext,
            ["POST"],
            isInternal: true,
            allowedCallers: [CallerServiceNames.Advice]),
        new(
            "internal-outcome-create",
            $@"^/internal/v1/contacts/(?<contactId>{Uuid})/outcomes/?$",
            GatewayServiceNames.ContactContext,
            ["POST"],
            isInternal: true,
            allowedCallers: [CallerServiceNames.Advice]),
        new(
            "internal-analysis",
            @"^/internal/v1/analysis/?$",
            GatewayServiceNames.Analysis,
            ["POST"],
            isInternal: true,
            allowedCallers: [CallerServiceNames.Advice]),
        new(
            "internal-advice-evidence-deletion",
            @"^/internal/v1/advice-evidence-deletions/?$",
            GatewayServiceNames.Advice,
            ["POST"],
            isInternal: true,
            allowedCallers: [CallerServiceNames.ContactContext]),
        new(
            "internal-advice-data-delete",
            $@"^/internal/v1/users/(?<userId>{Uuid})/advice-data/?$",
            GatewayServiceNames.Advice,
            Delete,
            isInternal: true,
            allowedCallers: [CallerServiceNames.ContactContext])
    ];
}

public static class GatewayServiceNames
{
    public const string Auth = "auth-service";
    public const string User = "user-service";
    public const string ExpressionStyle = "expression-style-service";
    public const string ContactContext = "contact-context-service";
    public const string Advice = "advice-service";
    public const string Analysis = "analysis-service";
}

public static class CallerServiceNames
{
    public const string Auth = "AuthService";
    public const string Advice = "AdviceService";
    public const string ContactContext = "ContactContextService";
}
