namespace SocialAssistant.Gateway.Routing;

public enum RouteMatchKind
{
    Found,
    InvalidParameters,
    NotFound,
    MethodNotAllowed
}

public sealed record RouteMatch(
    RouteMatchKind Kind,
    GatewayRoute? Route,
    IReadOnlySet<string> AllowedMethods)
{
    public static RouteMatch Found(GatewayRoute route) =>
        new(RouteMatchKind.Found, route, route.Methods);

    public static RouteMatch NotFound() =>
        new(RouteMatchKind.NotFound, null, new HashSet<string>(StringComparer.Ordinal));

    public static RouteMatch InvalidParameters() =>
        new(RouteMatchKind.InvalidParameters, null, new HashSet<string>(StringComparer.Ordinal));

    public static RouteMatch MethodNotAllowed(IEnumerable<string> allowedMethods) =>
        new(
            RouteMatchKind.MethodNotAllowed,
            null,
            new HashSet<string>(allowedMethods, StringComparer.Ordinal));
}
