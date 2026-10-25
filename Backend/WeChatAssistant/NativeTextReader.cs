using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Windows.Forms;

namespace Betweenly.WeChatAssistant;

internal sealed class NativeTextReader : IDisposable
{
    private readonly IntPtr window;
    private readonly OcrSession ocr;
    private readonly DataObject saved = new();
    private readonly List<IDisposable> owned = [];
    private uint lastCopy;
    private uint expectedSequence;
    private bool changed;
    public int Skipped { get; private set; }
    public bool ClipboardRestored { get; private set; } = true;
    public NativeTextReader(IntPtr window, OcrSession ocr)
    {
        this.window = window; this.ocr = ocr;
        try
        {
            var sequence = Native.GetClipboardSequenceNumber(); var data = Clipboard.GetDataObject();
            if (data is not null) foreach (var format in data.GetFormats(false))
            {
                object? clone = data.GetData(format, false) switch
                {
                    string text => text, string[] array => array.ToArray(), byte[] bytes => bytes.ToArray(),
                    MemoryStream stream => new MemoryStream(stream.ToArray()), Bitmap bitmap => new Bitmap(bitmap),
                    null => null, _ => throw new InvalidOperationException("Unsupported clipboard format")
                };
                if (clone is IDisposable disposable) owned.Add(disposable);
                if (clone is not null) saved.SetData(format, false, clone);
            }
            if (Native.GetClipboardSequenceNumber() != sequence) throw new InvalidOperationException("Clipboard changed");
            expectedSequence = sequence;
        }
        catch { foreach (var item in owned) item.Dispose(); throw new CaptureException("WECHAT_CLIPBOARD_BUSY", "暂时无法备份剪贴板，请稍后重试"); }
    }
    public string? Copy(Point screen)
    {
        EnsureExpectedClipboard();
        var before = PopupWindows().Select(w => w.Handle).ToHashSet();
        var target = window;
        Program.Diagnostic($"mouseTarget={target} screen={screen.X},{screen.Y}");
        var menu = IntPtr.Zero;
        try
        {
            Mouse(target, screen, true);
            for (var attempt = 0; attempt < 8 && menu == IntPtr.Zero; attempt++)
            {
                Thread.Sleep(35); menu = PopupWindows().Where(w => !before.Contains(w.Handle) && w.Rect.Contains(screen)).OrderBy(w => w.Rect.Width * w.Rect.Height).Select(w => w.Handle).FirstOrDefault();
            }
            if (menu == IntPtr.Zero) { Program.Diagnostic("menu=missing"); Skipped++; return null; }
            Native.GetWindowRect(menu, out var rect);
            Thread.Sleep(100);
            using var image = Print(menu, rect); var result = ocr.Read(image, 2);
            var lines = result["lines"]!.AsArray().Cast<JsonObject>().ToArray();
            Program.Diagnostic($"menu={rect.Right-rect.Left}x{rect.Bottom-rect.Top} lines={lines.Length}");
            var copy = TextCopyLine(result);
            if (copy is null) { Program.Diagnostic("menuText=false"); Skipped++; return null; }
            var words = copy["words"]!.AsArray();
            var x = words.Min(w => w!["x"]!.GetValue<double>()); var y = words.Min(w => w!["y"]!.GetValue<double>());
            var right = words.Max(w => w!["x"]!.GetValue<double>() + w["width"]!.GetValue<double>()); var bottom = words.Max(w => w!["y"]!.GetValue<double>() + w["height"]!.GetValue<double>());
            if (!Native.IsWindowVisible(menu)) throw new CaptureException("WECHAT_WINDOW_CHANGED", "读取期间微信菜单被关闭，请重试");
            var sequence = Native.GetClipboardSequenceNumber();
            EnsureExpectedClipboard(); sequence = Native.GetClipboardSequenceNumber();
            Mouse(menu, new Point(rect.Left + (int)((x + right) / 2), rect.Top + (int)((y + bottom) / 2)), false);
            for (var attempt = 0; attempt < 60 && Native.GetClipboardSequenceNumber() == sequence; attempt++) { System.Windows.Forms.Application.DoEvents(); Thread.Sleep(25); }
            if (Native.GetClipboardSequenceNumber() == sequence) throw new CaptureException("WECHAT_COPY_TIMEOUT", "微信复制未完成，请稍后重新读取");
            Native.GetWindowThreadProcessId(Native.GetClipboardOwner(), out var owner);
            try { using var p = Process.GetProcessById((int)owner); if (p.ProcessName is not ("Weixin" or "WeChat")) throw new InvalidOperationException(); }
            catch { throw new CaptureException("WECHAT_CLIPBOARD_CHANGED", "读取期间剪贴板被其他程序修改，已停止"); }
            lastCopy = Native.GetClipboardSequenceNumber(); changed = true;
            if (Clipboard.ContainsImage() || Clipboard.ContainsFileDropList() || !Clipboard.ContainsText(TextDataFormat.UnicodeText)) { Skipped++; return null; }
            var text = TextContent.Clean(Clipboard.GetText(TextDataFormat.UnicodeText));
            if (Native.GetClipboardSequenceNumber() != lastCopy)
            {
                // WeChat renders delayed clipboard formats when UnicodeText is first requested.
                Native.GetWindowThreadProcessId(Native.GetClipboardOwner(), out var renderedOwner);
                if (renderedOwner != owner) throw new CaptureException("WECHAT_CLIPBOARD_CHANGED", "读取期间剪贴板被修改，已停止，请重试");
                lastCopy = Native.GetClipboardSequenceNumber();
            }
            if (text.Length == 0) { Skipped++; return null; }
            return text;
        }
        finally { RestoreClipboard(); if (menu != IntPtr.Zero) CloseMenu(menu); }
    }
    internal static JsonObject? TextCopyLine(JsonObject result)
    {
        var lines = result["lines"]!.AsArray().Cast<JsonObject>().ToArray();
        var copy = lines.FirstOrDefault(l => TextContent.NormalizeSpacing(l["text"]!.GetValue<string>()) == "复制");
        return copy is not null && lines.Any(l => TextContent.NormalizeSpacing(l["text"]!.GetValue<string>()) is "放大阅读" or "翻译") ? copy : null;
    }
    private void EnsureExpectedClipboard()
    {
        if (Native.GetClipboardSequenceNumber() == expectedSequence) return;
        // OLE can materialize a restored format later and increment the sequence without
        // changing its content. Accept that case only when every original format matches.
        var data = Clipboard.GetDataObject(); var formats = saved.GetFormats(false);
        if (data is not null && formats.Order().SequenceEqual(data.GetFormats(false).Order()) && formats.All(format => Same(saved.GetData(format,false),data.GetData(format,false))))
        { expectedSequence = Native.GetClipboardSequenceNumber(); return; }
        throw new CaptureException("WECHAT_CLIPBOARD_CHANGED", "读取期间剪贴板被修改，已停止，请重试");
    }
    private static bool Same(object? a, object? b) => (a,b) switch
    {
        (string x,string y) => x==y,
        (string[] x,string[] y) => x.SequenceEqual(y),
        (byte[] x,byte[] y) => x.SequenceEqual(y),
        (MemoryStream x,MemoryStream y) => x.ToArray().SequenceEqual(y.ToArray()),
        (null,null) => true,
        _ => false
    };
    private static void Mouse(IntPtr handle, Point point, bool right)
    {
        var local = new Native.Point { X = point.X, Y = point.Y }; Native.ScreenToClient(handle, ref local);
        var position = new IntPtr((local.Y << 16) | (local.X & 0xffff));
        if (Native.SendMessageTimeout(handle, right ? 0x0204u : 0x0201u, new UIntPtr(right ? 2u : 1u), position, 2, 1000, out _) == IntPtr.Zero || Native.SendMessageTimeout(handle, right ? 0x0205u : 0x0202u, UIntPtr.Zero, position, 2, 1000, out _) == IntPtr.Zero)
            throw new CaptureException("WECHAT_WINDOW_CHANGED", "微信窗口未响应，请保持目标对话打开");
    }
    private static void CloseMenu(IntPtr menu)
    {
        if (!Native.IsWindowVisible(menu)) return;
        Native.SendMessageTimeout(menu, 0x0100, new UIntPtr(0x1b), IntPtr.Zero, 2, 500, out _);
        Native.SendMessageTimeout(menu, 0x0101, new UIntPtr(0x1b), IntPtr.Zero, 2, 500, out _); Thread.Sleep(30);
        if (Native.IsWindowVisible(menu)) Native.SendMessageTimeout(menu, 0x0010, UIntPtr.Zero, IntPtr.Zero, 2, 500, out _);
    }
    private static List<(IntPtr Handle, Rectangle Rect)> PopupWindows()
    {
        var windows = new List<(IntPtr, Rectangle)>();
        Native.EnumWindows((handle, _) =>
        {
            if (!Native.IsWindowVisible(handle) || !Native.GetWindowRect(handle, out var rect)) return true;
            var width = rect.Right - rect.Left; var height = rect.Bottom - rect.Top;
            if (width is < 90 or > 600 || height is < 60 or > 1000) return true;
            Native.GetWindowThreadProcessId(handle, out var id);
            try { using var p = Process.GetProcessById((int)id); if (p.ProcessName is "Weixin" or "WeChat") windows.Add((handle, Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom))); } catch (ArgumentException) { }
            return true;
        }, IntPtr.Zero);
        return windows;
    }
    private static Bitmap Print(IntPtr handle, Native.Rect rect)
    {
        var image = new Bitmap(rect.Right - rect.Left, rect.Bottom - rect.Top, System.Drawing.Imaging.PixelFormat.Format24bppRgb); using var graphics = Graphics.FromImage(image); var hdc = graphics.GetHdc(); bool printed;
        try { printed = Native.PrintWindow(handle, hdc, 2); } finally { graphics.ReleaseHdc(hdc); }
        if (!printed) { image.Dispose(); throw new CaptureException("WECHAT_WINDOW_CHANGED", "无法读取微信菜单，请重试"); }
        return image;
    }
    private void RestoreClipboard()
    {
        if (changed && Native.GetClipboardSequenceNumber() == lastCopy)
        {
            try
            {
                if (saved.GetFormats(false).Length == 0) Clipboard.Clear(); else Clipboard.SetDataObject(saved, true, 5, 50);
                System.Windows.Forms.Application.DoEvents(); Thread.Sleep(100);
                expectedSequence = Native.GetClipboardSequenceNumber(); changed = false;
            }
            catch (ExternalException) { ClipboardRestored = false; }
        }
    }
    public void Dispose()
    {
        RestoreClipboard();
        foreach (var item in owned) item.Dispose();
    }
}
