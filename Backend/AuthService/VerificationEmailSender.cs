using Betweenly.Shared;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Betweenly.Auth;

public sealed class VerificationEmailSender(IConfiguration configuration)
{
    private bool LocalTest => configuration["Email:TestMode"] == "true" && configuration["Email:SmtpHost"] == "127.0.0.1";
    public bool Configured => !string.IsNullOrWhiteSpace(configuration["Email:SmtpHost"])
        && !string.IsNullOrWhiteSpace(configuration["Email:FromAddress"])
        && (LocalTest || !string.IsNullOrWhiteSpace(configuration["Email:Username"]) && !string.IsNullOrWhiteSpace(configuration["Email:Password"]))
        && (configuration["Email:VerificationSecret"]?.Length ?? 0) >= 32;
    public void RequireConfiguration()
    {
        if (!Configured) throw new ApiException(503, "EMAIL_NOT_CONFIGURED", "验证码邮件尚未配置，请联系管理员配置发信邮箱");
    }
    public async Task Send(string email, string code, CancellationToken cancellationToken, bool passwordReset = false)
    {
        RequireConfiguration();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); timeout.CancelAfter(TimeSpan.FromSeconds(15));
        try
        {
            var message = new MimeMessage();
            message.From.Add(new MailboxAddress("Betweenly", configuration["Email:FromAddress"]!));
            message.To.Add(MailboxAddress.Parse(email)); message.Subject = passwordReset ? "Betweenly 重置密码验证码" : "Betweenly 邮箱验证码";
            var action = passwordReset ? "重置密码" : "邮箱验证";
            message.Body = new TextPart("plain") { Text = $"你的 Betweenly {action}验证码是：{code}\n\n验证码 10 分钟内有效，请勿向他人提供。\n如果不是你本人操作，请忽略此邮件。\n\nBetweenly · Copyright © 2026-2027" };
            using var smtp = new SmtpClient { Timeout = 15000 };
            var mode = LocalTest ? SecureSocketOptions.None : configuration["Email:Security"] == "StartTls" ? SecureSocketOptions.StartTls : SecureSocketOptions.SslOnConnect;
            await smtp.ConnectAsync(configuration["Email:SmtpHost"]!, configuration.GetValue<int?>("Email:SmtpPort") ?? 465, mode, timeout.Token);
            if (!LocalTest) await smtp.AuthenticateAsync(configuration["Email:Username"]!, configuration["Email:Password"]!, timeout.Token);
            await smtp.SendAsync(message, timeout.Token); await smtp.DisconnectAsync(true, timeout.Token);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch { throw new ApiException(503, "EMAIL_DELIVERY_FAILED", "验证码邮件发送失败，请稍后重试或联系管理员"); }
    }
}
