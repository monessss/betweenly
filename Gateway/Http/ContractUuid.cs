namespace SocialAssistant.Gateway.Http;

public static class ContractUuid
{
    public static bool IsValid(string value) =>
        Guid.TryParseExact(value, "D", out var parsed) &&
        value == parsed.ToString("D") &&
        value[14] == '4' &&
        value[19] is '8' or '9' or 'a' or 'b';
}
