using Betweenly.Shared;
using System.Net.Mail;
using System.Text;
using System.Text.Json.Nodes;

namespace Betweenly.Accounts;

public static class AccountValidation
{
    public static string Text(JsonObject value, string field, int min, int max, bool trim = true)
    {
        if (value[field] is not JsonValue node || !node.TryGetValue<string>(out var text)) throw Api.Invalid(field + " 必须是字符串");
        text = trim ? text.Trim() : text;
        if (text.Length < min || text.Length > max || text.Any(char.IsControl)) throw Api.Invalid(field + " 长度或格式不符合要求");
        return text;
    }
    public static string Email(JsonObject value)
    {
        var email = Text(value, "email", 3, 254);
        if (email.Any(char.IsWhiteSpace) || !MailAddress.TryCreate(email, out var parsed) || parsed.Address != email || !email.Contains('@')) throw Api.Invalid("邮箱格式不正确");
        return email.ToLowerInvariant();
    }
    public static string Username(JsonObject value)
    {
        var name = Text(value, "username", 2, 32).Normalize(NormalizationForm.FormKC);
        if (name.Length > 32 || name.Any(c => !char.IsLetterOrDigit(c) && c is not ('_' or '-' or '.'))) throw Api.Invalid("用户名需为 2–32 位字母、汉字、数字、下划线、点或连字符");
        return name;
    }
    public static string NormalizeUsername(string value) => value.Normalize(NormalizationForm.FormKC).ToUpperInvariant();
    public static string? Optional(JsonObject value, string field, int max)
        => value[field] is null ? null : Text(value, field, 0, max);
}
