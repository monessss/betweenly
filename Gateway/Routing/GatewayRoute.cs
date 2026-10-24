using System.Text.RegularExpressions;
using SocialAssistant.Gateway.Http;

namespace SocialAssistant.Gateway.Routing;

public sealed class GatewayRoute
{
    private static readonly IReadOnlySet<string> EmptyCallers =
        new HashSet<string>(StringComparer.Ordinal);

    public GatewayRoute(
        string name,
        string pathPattern,
        string service,
        IEnumerable<string> methods,
        bool isInternal = false,
        IEnumerable<string>? allowedCallers = null)
    {
        Name = name;
        PathPattern = new Regex(
            pathPattern,
            RegexOptions.CultureInvariant | RegexOptions.Compiled);
        Service = service;
        Methods = new HashSet<string>(
            methods.Select(method => method.ToUpperInvariant()),
            StringComparer.Ordinal);
        IsInternal = isInternal;
        AllowedCallers = allowedCallers is null
            ? EmptyCallers
            : new HashSet<string>(allowedCallers, StringComparer.Ordinal);
    }

    public string Name { get; }

    public Regex PathPattern { get; }

    public string Service { get; }

    public IReadOnlySet<string> Methods { get; }

    public bool IsInternal { get; }

    public IReadOnlySet<string> AllowedCallers { get; }

    public bool AllowsMethod(string method) =>
        Methods.Contains(method.ToUpperInvariant());

    public bool HasValidParameters(string path) =>
        PathPattern.Match(path).Groups.Cast<Group>()
            .Where(group => group.Name != "0")
            .All(group => ContractUuid.IsValid(group.Value));
}
