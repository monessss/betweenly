using System.Drawing;
using System.Text.Json.Nodes;
using Betweenly.WeChatAssistant;
using Assistant = Betweenly.WeChatAssistant.Program;

static void Check(bool success, string message) { if (!success) throw new Exception(message); Console.WriteLine("PASS " + message); }
static JsonObject Menu(params string[] labels) => new() { ["lines"] = new JsonArray(labels.Select(text => (JsonNode)new JsonObject { ["text"] = text }).ToArray()) };
foreach (var light in new[] { false, true })
{
    using var image = new Bitmap(700,400);
    using (var g = Graphics.FromImage(image))
    {
        g.Clear(light ? Color.FromArgb(245,245,245) : Color.FromArgb(30,30,31));
        using var incoming = new SolidBrush(light ? Color.White : Color.FromArgb(47,47,48));
        using var outgoing = new SolidBrush(Color.FromArgb(0,180,80));
        g.FillRectangle(incoming,70,40,200,65);
        g.FillRectangle(outgoing,420,160,210,45);
        g.FillRectangle(incoming,70,240,200,40);
        using var ink = new SolidBrush(light ? Color.Black : Color.White);
        g.DrawString("10:30",SystemFonts.DefaultFont,ink,300,120);
        g.DrawString("名字",SystemFonts.DefaultFont,ink,70,15);
        g.DrawString("文字一\n文字二",SystemFonts.DefaultFont,ink,80,50);
    }
    var targets = BubbleLocator.Find(image,1);
    Check(targets.Count==3,$"{(light ? "light" : "dark")} bubbles found without OCR; multiline stays one message");
    Check(targets.Select(t=>t.Sender).SequenceEqual(new[]{"OTHER","USER","OTHER"}),"speaker and chronological order follow bubbles");
    Check(targets.All(t=>t.Bounds.Contains(t.Hit)),"copy hit remains inside each bubble");
}
Check(TextContent.Clean(" 今 天  天 气 很 好 ， 去 散 步 。 ")=="今天天气很好，去散步。","Chinese and punctuation spacing is removed");
Check(TextContent.Clean("Hello    world\tfrom Betweenly")=="Hello world from Betweenly","necessary English word spaces survive");
Check(TextContent.Clean("用 DeepSeek API 写 MVP")=="用DeepSeek API写MVP","mixed Chinese and English spacing stays readable");
Check(TextContent.Clean("你好😀[捂脸]👨‍👩‍👧‍👦🇨🇳👍🏽1️⃣❤️再见")=="你好再见","Unicode emoji, sequences, flags and WeChat emoticons are removed");
Check(TextContent.Clean("[微笑] 😀 ")=="","emoji-only messages become empty and are skipped");
Check(TextContent.Clean("[项目] x = 1; https://example.com/a?b=2")=="[项目] x = 1; https://example.com/a?b=2","ordinary bracketed text, code and URLs survive");
Check(TextContent.Clean("第一行\r\n第二行\nHello world")=="第一行\n第二行\nHello world","native paragraph breaks survive without OCR wrap guessing");
Check(TextContent.Clean("测试复合字：𠮷、辩、器")=="测试复合字：𠮷、辩、器","native copied characters are not split or guessed");
Check(NativeTextReader.TextCopyLine(Menu("复 制","放 大 阅 读","转发")) is not null,"text menu qualifies even with OCR spacing");
Check(NativeTextReader.TextCopyLine(Menu("复制","翻 译","转发")) is not null,"text translation menu also qualifies");
Check(NativeTextReader.TextCopyLine(Menu("复制","另存为","提取文字")) is null,"image menu does not qualify");
Check(NativeTextReader.TextCopyLine(Menu("复制","收藏","多选","转发")) is null,"forwarded-chat card menu does not qualify");
Check(NativeTextReader.TextCopyLine(Menu("添加表情","转发","删除")) is null,"sticker menu does not qualify");
using var conversation = new Bitmap(500,1000);
using (var g = Graphics.FromImage(conversation))
{
    g.Clear(Color.FromArgb(30,30,31));
    using var bubble = new SolidBrush(Color.FromArgb(48,48,48));
    for (var i=0;i<12;i++)
    {
        g.FillRectangle(bubble,60,i*80+10,180+i*8,48);
        g.DrawString(i % 3 == 0 ? "收到" : "message "+i,SystemFonts.DefaultFont,Brushes.White,70,i*80+20);
    }
}
using var first = conversation.Clone(new Rectangle(0,240,500,500),conversation.PixelFormat);
using var earlier = conversation.Clone(new Rectangle(0,120,500,500),conversation.PixelFormat);
Check(ViewportTracker.DownwardShift(first,earlier)==120,"physical image overlap locates an upward scroll");
Check(ViewportTracker.DownwardShift(first,first)==0,"stationary viewport cannot add copies to fill the requested count");
using var unrelated = new Bitmap(500,500);
using(var g=Graphics.FromImage(unrelated))g.Clear(Color.White);
Check(ViewportTracker.DownwardShift(first,unrelated) is null,"unrelated view is rejected rather than stitched and double counted");
var oldTarget=new Assistant.TextTarget(new Rectangle(60,20,180,48),new Point(100,40),"OTHER");
var old = new ViewportTracker.Seen(oldTarget,"收到");
var same = oldTarget with { Bounds=new Rectangle(60,140,180,48),Hit=new Point(100,160) };
Check(ViewportTracker.FindPrevious([old],same,120,1)==old,"same physical bubble is reused across overlapping views");
var separate=oldTarget with { Bounds=new Rectangle(60,60,180,48),Hit=new Point(100,80) };
Check(ViewportTracker.FindPrevious([old],separate,120,1) is null,"separate identical messages are not falsely merged by text");
var clipped=oldTarget with { Bounds=new Rectangle(60,0,180,28) };
var expanded=oldTarget with { Bounds=new Rectangle(60,100,180,48) };
Check(ViewportTracker.FindPrevious([new ViewportTracker.Seen(clipped,"收到")],expanded,120,1) is not null,"partially clipped bubble matches by its stable bottom edge");
