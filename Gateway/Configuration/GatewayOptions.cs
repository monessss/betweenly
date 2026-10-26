namespace SocialAssistant.Gateway.Configuration;

public sealed class GatewayOptions
{
    public const string SectionName = "Gateway";

    public int RequestTimeoutSeconds { get; init; } = 30;

    public int ReadinessTimeoutSeconds { get; init; } = 2;

    public DevelopmentAuthOptions DevelopmentAuth { get; init; } = new();
    public DesktopAuthOptions DesktopAuth { get; init; } = new();
    public AccountAuthOptions AccountAuth { get; init; } = new();
    public string[] TrustedProxies { get; init; } = [];

    public Dictionary<string, DownstreamServiceOptions> Services { get; init; } =
        new(StringComparer.OrdinalIgnoreCase);

    public Dictionary<string, string> ServiceCredentials { get; init; } =
        new(StringComparer.Ordinal);
}

public sealed class AccountAuthOptions
{
    public bool Enabled { get; init; }
    public int TimeoutSeconds { get; init; } = 5;
}

public sealed class DevelopmentAuthOptions
{
    public bool Enabled { get; init; }
}

public sealed class DesktopAuthOptions
{
    public bool Enabled { get; init; }
    public string Token { get; init; } = string.Empty;
    public string UserId { get; init; } = string.Empty;
    public string WeChatImportToken { get; init; } = string.Empty;
}

public sealed class DownstreamServiceOptions
{
    public string BaseUrl { get; init; } = string.Empty;

    public string GatewayKey { get; init; } = string.Empty;

    public string HealthPath { get; init; } = "/readyz";
}
