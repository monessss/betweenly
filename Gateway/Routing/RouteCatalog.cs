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
    public const string ExpressionStyle = "expression-style-service";
    public const string ContactContext = "contact-context-service";
    public const string Advice = "advice-service";
    public const string Analysis = "analysis-service";
}

public static class CallerServiceNames
{
    public const string Advice = "AdviceService";
    public const string ContactContext = "ContactContextService";
}
