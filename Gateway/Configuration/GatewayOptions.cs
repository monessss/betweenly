namespace SocialAssistant.Gateway.Configuration;

public sealed class GatewayOptions
{
    public const string SectionName = "Gateway";

    public int RequestTimeoutSeconds { get; init; } = 30;

    public int ReadinessTimeoutSeconds { get; init; } = 2;

    public DevelopmentAuthOptions DevelopmentAuth { get; init; } = new();

    public Dictionary<string, DownstreamServiceOptions> Services { get; init; } =
        new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, string> ServiceCredentials { get; init; } =
        new(StringComparer.Ordinal);
}

public sealed class DevelopmentAuthOptions
{
    public bool Enabled { get; init; }
}

public sealed class DownstreamServiceOptions
{
    public string BaseUrl { get; init; } = string.Empty;

    public string GatewayKey { get; init; } = string.Empty;

    public string HealthPath { get; init; } = "/readyz";
}
