using System.Diagnostics;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Betweenly.WeChatAssistant;

internal static class Program
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            Native.SetProcessDpiAwarenessContext(new IntPtr(-4));
            var window = FindWindow();
            if (args.FirstOrDefault() == "status")
            {
                Console.WriteLine(JsonSerializer.Serialize(new { available = window != IntPtr.Zero, version = Version(window), method = "WINDOWS_LOCAL_TEXT", message = window == IntPtr.Zero ? "请启动并登录电脑微信" : "打开要导入的微信对话" }, Json)); return 0;
            }
            if (args.FirstOrDefault() != "capture") throw new CaptureException("VALIDATION_ERROR", "不支持的助手命令");
            if (window == IntPtr.Zero) throw new CaptureException("WECHAT_NOT_RUNNING", "请打开电脑微信聊天主窗口，并显示要导入的对话");
            if (args.Length > 1 && !int.TryParse(args[1], out _)) throw new CaptureException("VALIDATION_ERROR", "读取条数应为 1 至 100 的整数");
            var limit = args.Length > 1 ? int.Parse(args[1]) : 50;
            if (limit is < 1 or > 100) throw new CaptureException("VALIDATION_ERROR", "读取条数应为 1 至 100");
            var result = Capture(window, limit);
            Console.WriteLine(result.ToJsonString()); return 0;
        }
        catch (CaptureException e) { Console.WriteLine(JsonSerializer.Serialize(new { error = new { code = e.Code, message = e.Message } }, Json)); return 2; }
        catch { Console.WriteLine(JsonSerializer.Serialize(new { error = new { code = "WECHAT_CAPTURE_FAILED", message = "本地读取未完成，请确认微信聊天窗口已打开，且系统已安装中文 OCR" } }, Json)); return 2; }
    }

    private static IntPtr FindWindow()
    {
        IntPtr found = IntPtr.Zero;
        Native.EnumWindows((handle, _) =>
        {
            if (!Native.IsWindowVisible(handle)) return true;
            Native.GetWindowThreadProcessId(handle, out var id);
            try
            {
                using var process = Process.GetProcessById((int)id);
                if (process.ProcessName is not ("Weixin" or "WeChat")) return true;
                var title = new StringBuilder(256); Native.GetWindowText(handle, title, title.Capacity);
                if (title.ToString() is "微信" or "Weixin" or "WeChat") { found = handle; return false; }
            }
            catch (ArgumentException) { }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    private static string? Version(IntPtr handle)
    {
        if (handle == IntPtr.Zero) return null;
        try { Native.GetWindowThreadProcessId(handle, out var id); using var p = Process.GetProcessById((int)id); return p.MainModule?.FileVersionInfo.FileVersion; } catch { return null; }
    }
    private static JsonObject Capture(IntPtr window, int limit)
    {
        var all = new List<JsonObject>(); string title = ""; var warnings = new JsonArray("仅读取可复制纯文本；已过滤 emoji、表情包及转发卡片。时间未明确显示的保持未知。");
        Bitmap? previousFrame = null;
        List<ViewportTracker.Seen> previousMessages = [];
        var timer = Stopwatch.StartNew();
        string? headingSignature = null;
        int? sidebarLeft = null;
        int? composerTop = null;
        using var ocr = new OcrSession();
        var reader = new NativeTextReader(window, ocr);
        try
        {
            if (Native.IsIconic(window)) throw new CaptureException("WECHAT_WINDOW_MINIMIZED", "请还原微信聊天窗口后重试");
            for (var page = 0; page < 80 && all.Count < limit; page++)
            {
                if (timer.Elapsed.TotalSeconds > 52) { warnings.Add("已达到本次读取时限。"); break; }
                if (!Native.GetWindowRect(window, out var rect)) throw new CaptureException("WECHAT_CAPTURE_FAILED", "无法获取微信窗口");
                var scale = Math.Max(1, Native.GetDpiForWindow(window) / 96.0);
                if (rect.Right - rect.Left < 650 * scale || rect.Bottom - rect.Top < 450 * scale) throw new CaptureException("WECHAT_WINDOW_TOO_SMALL", "请将微信窗口放大后重试");
                using var full = CaptureFrame(window, rect);
                var left = sidebarLeft ?? DetectSidebar(full, scale); sidebarLeft = left;
                var top = (int)(90 * scale); var bottom = composerTop ?? DetectComposer(full, left, scale); composerTop = bottom;
                Diagnostic($"frame={full.Width}x{full.Height} scale={scale} crop={left},{top},{bottom}");
                if (bottom - top < 120 * scale) throw new CaptureException("WECHAT_LAYOUT_UNSUPPORTED", "当前微信布局暂无法识别，请打开普通聊天窗口");
                var headingBounds = new Rectangle(left, (int)(32 * scale), Math.Max(100, full.Width - left - (int)(130 * scale)), (int)(35 * scale));
                var signature = HeadingSignature(full, headingBounds);
                if (headingSignature is not null && signature != headingSignature) throw new CaptureException("WECHAT_CONVERSATION_CHANGED", "读取期间微信会话发生变化，请重新预览");
                headingSignature = signature;
                using var body = full.Clone(new Rectangle(left, top, full.Width - left - (int)(12 * scale), bottom - top), full.PixelFormat);
                var shift = previousFrame is null ? 0 : ViewportTracker.DownwardShift(previousFrame, body);
                Diagnostic($"scrollShift={shift}");
                if (previousFrame is not null && shift is null) { warnings.Add("无法确认滚动后的消息重叠，已停止以避免重复读取。"); break; }
                if (previousFrame is not null && shift == 0) { warnings.Add("未加载到更早消息。"); break; }
                var targets = BubbleLocator.Find(body, scale);
                Diagnostic($"targets={targets.Count}");
                var messages = new List<ViewportTracker.Seen>();
                // Start at the newest visible bubble so a small limit also returns the latest items.
                foreach (var item in targets.OrderByDescending(t => t.Bounds.Top))
                {
                    if (all.Count >= limit || timer.Elapsed.TotalSeconds > 52) break;
                    var previous = previousFrame is null ? null : ViewportTracker.FindPrevious(previousMessages, item, shift!.Value, scale);
                    if (previous is not null) { messages.Add(new ViewportTracker.Seen(item, previous.Text)); continue; }
                    // New messages must be above the oldest previously visible message. If an old
                    // bubble's shape changed at an edge, skip it rather than count it a second time.
                    if (previousFrame is not null && item.Bounds.Top >= shift!.Value) continue;
                    VerifyView(window, rect, full, new Rectangle(left, 0, full.Width-left, bottom));
                    var text = reader.Copy(new Point(rect.Left + left + item.Hit.X, rect.Top + top + item.Hit.Y));
                    VerifyView(window, rect, full, new Rectangle(left, 0, full.Width-left, bottom));
                    messages.Add(new ViewportTracker.Seen(item, text));
                    if (string.IsNullOrEmpty(text)) continue;
                    if (text.Length > 4000) { if (!warnings.Any(w => w!.GetValue<string>().Contains("超长"))) warnings.Add("超长消息已跳过，请单独录入。"); continue; }
                    all.Insert(0, new JsonObject { ["sender"] = item.Sender, ["text"] = text, ["sentAt"] = null, ["sourceType"] = "USER_RELAY", ["isVerbatim"] = false });
                }
                if (page == 0)
                {
                    using var heading = full.Clone(headingBounds, full.PixelFormat);
                    var headingOcr = ocr.Read(heading);
                    var capturedTitle = TextContent.NormalizeSpacing(string.Join(" ", headingOcr["lines"]!.AsArray().Select(l => l!["text"]!.GetValue<string>())));
                    title = capturedTitle;
                    if (title.Length == 0) warnings.Add("未识别到微信会话名称，请确认没有选错对话。");
                }
                previousFrame?.Dispose(); previousFrame = new Bitmap(body); previousMessages = messages;
                Diagnostic($"collected={all.Count}/{limit}");
                if (all.Count >= limit) break;
                if (timer.Elapsed.TotalSeconds > 52) { warnings.Add("已达到本次读取时限。"); break; }
                {
                    var x = rect.Left + left + (full.Width - left) / 2; var y = rect.Top + (top + bottom) / 2;
                    var target = Native.FindWindowEx(window, IntPtr.Zero, "MMUIRenderSubWindowHW", null); if (target == IntPtr.Zero) target = window;
                    var position = new IntPtr((y << 16) | (x & 0xffff));
                    var scrolled = true;
                    for (var tick = 0; tick < Math.Clamp((int)((bottom-top)*.45/(60*scale)),1,8); tick++)
                    {
                        if (Native.SendMessageTimeout(target, 0x020A, new UIntPtr(480u << 16), position, 2, 1000, out _) == IntPtr.Zero) { scrolled = false; break; }
                        Thread.Sleep(25);
                    }
                    if (!scrolled) { warnings.Add("微信未响应上翻；已保留当前读取结果。"); break; }
                    Thread.Sleep(800);
                }
            }
        }
        catch (CaptureException e) when (e.Code is "WECHAT_CLIPBOARD_CHANGED" or "WECHAT_COPY_TIMEOUT" && all.Count > 0)
        {
            warnings.Add(e.Message + "；已保留读取完成的消息。");
        }
        finally
        {
            previousFrame?.Dispose();
            reader.Dispose();
        }
        if (all.Count < limit) warnings.Add($"目标 {limit} 条，实际读取 {all.Count} 条；未用重复内容补足。");
        if (!reader.ClipboardRestored) warnings.Add("剪贴板还原未完成，请核对剪贴板内容。");
        if (reader.Skipped > 0) warnings.Add("已跳过 " + reader.Skipped + " 项非纯文本或无法确认的内容。");
        if (all.Count == 0) throw new CaptureException("WECHAT_NO_MESSAGES", "未读取到可复制的纯文本消息；请保持微信文字消息可见，并关闭已有菜单后重试");
        if (Regex.IsMatch(title, @"[（(]\s*\d+\s*[)）]\s*$"))
        {
            foreach (var message in all) if (message["sender"]!.GetValue<string>() == "OTHER") message["sender"] = "UNKNOWN";
            warnings.Add("当前可能是群聊，非本人消息的说话人需逐条确认。");
        }
        var array = new JsonArray();
        foreach (var message in all) { message["clientId"] = Guid.NewGuid().ToString(); array.Add(message); }
        return new JsonObject { ["conversationTitle"] = title, ["wechatVersion"] = Version(window), ["capturedAt"] = DateTimeOffset.UtcNow.ToString("O"), ["messages"] = array, ["warnings"] = warnings };
    }
    internal sealed record TextTarget(Rectangle Bounds, Point Hit, string Sender);
    private static Bitmap CaptureFrame(IntPtr window, Native.Rect rect)
    {
        var image = new Bitmap(rect.Right-rect.Left, rect.Bottom-rect.Top, PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(image); var hdc = graphics.GetHdc(); bool printed;
        try { printed = Native.PrintWindow(window, hdc, 2); } finally { graphics.ReleaseHdc(hdc); }
        if (!printed)
        {
            if (Native.GetForegroundWindow() != window) { image.Dispose(); throw new CaptureException("WECHAT_WINDOW_BLOCKED", "请将微信聊天窗口置于前台后重试"); }
            graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, image.Size, CopyPixelOperation.SourceCopy);
        }
        return image;
    }
    private static string HeadingSignature(Bitmap image, Rectangle bounds)
    {
        using var bytes = new MemoryStream();
        for (var y = bounds.Top; y < bounds.Bottom; y += 2) for (var x = bounds.Left; x < bounds.Right; x += 2)
        { var color = image.GetPixel(x,y); bytes.WriteByte((byte)(color.R/16)); bytes.WriteByte((byte)(color.G/16)); bytes.WriteByte((byte)(color.B/16)); }
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes.ToArray()));
    }
    private static void VerifyView(IntPtr window, Native.Rect expected, Bitmap original, Rectangle bounds)
    {
        if (Native.IsIconic(window) || !Native.GetWindowRect(window, out var actual) || actual.Left!=expected.Left || actual.Top!=expected.Top || actual.Right!=expected.Right || actual.Bottom!=expected.Bottom)
            throw new CaptureException("WECHAT_WINDOW_CHANGED", "读取期间微信窗口发生变化，请保持目标对话打开后重试");
        using var current = CaptureFrame(window, actual); var changed = 0; var total = 0;
        for (var y=bounds.Top; y<bounds.Bottom; y+=8) for(var x=bounds.Left; x<bounds.Right; x+=8)
        { var a=original.GetPixel(x,y); var b=current.GetPixel(x,y); total++; if(Math.Abs(a.R-b.R)+Math.Abs(a.G-b.G)+Math.Abs(a.B-b.B)>45) changed++; }
        Diagnostic($"viewChanged={changed}/{total}");
        if (changed > Math.Max(3,total*.02)) throw new CaptureException("WECHAT_WINDOW_CHANGED", "读取期间微信内容发生变化，请重新预览");
    }
    // The conversation column has a sustained vertical background boundary. No contact list pixels enter OCR.
    private static int DetectSidebar(Bitmap image, double scale)
    {
        var min = (int)(210 * scale); var max = Math.Min((int)(430 * scale), image.Width / 2);
        var best = (int)(260 * scale); double score = 0;
        for (var x = min; x < max; x++)
        {
            double value = 0;
            for (var ratio = .18; ratio < .72; ratio += .025) { var y = (int)(image.Height * ratio); var a = image.GetPixel(x - 2, y); var b = image.GetPixel(x + 2, y); value += Math.Min(35, Math.Abs(a.R - b.R) + Math.Abs(a.G - b.G) + Math.Abs(a.B - b.B)); }
            if (value > score) { score = value; best = x + (int)(12 * scale); }
        }
        return Math.Clamp(best, min, max);
    }
    private static int DetectComposer(Bitmap image, int left, double scale)
    {
        // Input panel separator is a long horizontal rule, unlike a chat bubble edge.
        var start = (int)(image.Height * .52); var end = image.Height - (int)(110 * scale); var right = image.Width - (int)(30 * scale);
        var best = (int)(image.Height * .74); double bestScore = 0;
        for (var y = start; y < end; y++)
        {
            var edges = 0;
            for (var x = left + (int)(40 * scale); x < right; x += 8)
            { var a = image.GetPixel(x, y - 2); var b = image.GetPixel(x, y + 2); if (Math.Abs(a.R - b.R) + Math.Abs(a.G - b.G) + Math.Abs(a.B - b.B) > 12) edges++; }
            if (edges > bestScore) { bestScore = edges; best = y - (int)(8 * scale); }
        }
        return Math.Clamp(best, (int)(160 * scale), image.Height - (int)(100 * scale));
    }
    internal static void Diagnostic(string value) { if (Environment.GetEnvironmentVariable("BETWEENLY_CAPTURE_DIAGNOSTICS") == "1") Console.Error.WriteLine(value); }
}

internal sealed class CaptureException(string code, string message) : Exception(message) { public string Code { get; } = code; }
internal static class Native
{
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr handle, ref Point point);
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] public static extern IntPtr GetClipboardOwner();
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr handle, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string? title);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr handle, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
