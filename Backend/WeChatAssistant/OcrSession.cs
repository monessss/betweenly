using System.Diagnostics;
using System.Drawing.Imaging;
using System.Text;
using System.Text.Json.Nodes;

namespace Betweenly.WeChatAssistant;

internal sealed class OcrSession : IDisposable
{
    private readonly Process process;
    private readonly Task<string> errors;
    public OcrSession()
    {
        var start = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
        foreach (var arg in new[] { "-NoProfile", "-NonInteractive", "-File", Path.Combine(AppContext.BaseDirectory, "ocr.ps1") }) start.ArgumentList.Add(arg);
        process = Process.Start(start) ?? throw new CaptureException("WECHAT_OCR_UNAVAILABLE", "无法启动本机定位组件"); errors = process.StandardError.ReadToEndAsync();
    }
    public JsonObject Read(Bitmap image, double enlargement = 1)
    {
        using var resized = new Bitmap((int)(image.Width * enlargement), (int)(image.Height * enlargement), PixelFormat.Format24bppRgb);
        var brightness = 0L; var samples = 0;
        for (var y = 0; y < image.Height; y += 12) for (var x = 0; x < image.Width; x += 12) { var pixel = image.GetPixel(x, y); brightness += pixel.R + pixel.G + pixel.B; samples++; }
        using (var g = Graphics.FromImage(resized))
        {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            using var attributes = new ImageAttributes();
            if (brightness < samples * 3L * 128) attributes.SetColorMatrix(new ColorMatrix(new[] { new float[] {-1,0,0,0,0}, [0,-1,0,0,0], [0,0,-1,0,0], [0,0,0,1,0], [1,1,1,0,1] }));
            g.DrawImage(image, new Rectangle(0, 0, resized.Width, resized.Height), 0, 0, image.Width, image.Height, GraphicsUnit.Pixel, attributes);
        }
        using var buffer = new MemoryStream(); resized.Save(buffer, ImageFormat.Png);
        process.StandardInput.WriteLine(Convert.ToBase64String(buffer.ToArray())); process.StandardInput.Flush(); var output = process.StandardOutput.ReadLineAsync();
        if (!output.Wait(TimeSpan.FromSeconds(12))) { process.Kill(true); throw new CaptureException("WECHAT_OCR_TIMEOUT", "本机消息定位超时，请减少读取条数"); }
        var result = output.Result is { } line ? JsonNode.Parse(line.Trim('\uFEFF')) as JsonObject : null;
        if (result is null || result["error"] is not null) throw new CaptureException("WECHAT_OCR_UNAVAILABLE", "本机定位不可用，请确认中文 OCR 组件可用");
        if (enlargement != 1) foreach (var word in result["lines"]!.AsArray().SelectMany(l => l!["words"]!.AsArray()).Cast<JsonObject>()) foreach (var field in new[] { "x", "y", "width", "height" }) word[field] = word[field]!.GetValue<double>() / enlargement;
        return result;
    }
    public void Dispose()
    {
        try { process.StandardInput.Close(); if (!process.WaitForExit(1000)) process.Kill(true); } catch (InvalidOperationException) { }
        process.Dispose();
    }
}
