using Microsoft.Extensions.Options;
using SocialAssistant.Gateway.Configuration;
using SocialAssistant.Gateway.Routing;

namespace SocialAssistant.Gateway.Proxy;

public sealed class ReadinessProbe(
    IHttpClientFactory httpClientFactory,
    IOptions<GatewayOptions> options,
    RouteCatalog routes)
{
    public const string ClientName = "readiness";

    public async Task<ReadinessResult> CheckAsync(CancellationToken cancellationToken)
    {
        var gatewayOptions = options.Value;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(
            Math.Max(1, gatewayOptions.ReadinessTimeoutSeconds)));

        var checks = routes.All.Select(route => route.Service).Distinct(StringComparer.Ordinal)
            .Select(name => gatewayOptions.Services.TryGetValue(name, out var service)
                ? CheckServiceAsync(name, service, timeout.Token)
                : Task.FromResult(new DependencyReadiness(name, false)));

        var results = await Task.WhenAll(checks);
        return new ReadinessResult(
            results.All(result => result.Healthy),
            results);
    }

    private async Task<DependencyReadiness> CheckServiceAsync(
        string name,
        DownstreamServiceOptions service,
        CancellationToken cancellationToken)
    {
        try
        {
            var uri = new Uri(
                service.BaseUrl.TrimEnd('/') + "/" +
                service.HealthPath.TrimStart('/'),
                UriKind.Absolute);
            var client = httpClientFactory.CreateClient(ClientName);
            using var response = await client.GetAsync(
                uri,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            return new DependencyReadiness(name, response.IsSuccessStatusCode);
        }
        catch (Exception exception) when (
            exception is HttpRequestException or OperationCanceledException)
        {
            return new DependencyReadiness(name, false);
        }
    }
}

public sealed record ReadinessResult(
    bool IsReady,
    IReadOnlyList<DependencyReadiness> Dependencies);

public sealed record DependencyReadiness(string Service, bool Healthy);
