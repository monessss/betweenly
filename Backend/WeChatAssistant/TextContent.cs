using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Betweenly.WeChatAssistant;

internal static partial class TextContent
{
    private const string Faces = "微笑|撇嘴|色|发呆|得意|流泪|害羞|闭嘴|睡|大哭|尴尬|发怒|调皮|呲牙|惊讶|难过|酷|冷汗|抓狂|吐|偷笑|可爱|白眼|傲慢|饥饿|困|惊恐|流汗|憨笑|悠闲|奋斗|咒骂|疑问|嘘|晕|衰|骷髅|敲打|再见|擦汗|抠鼻|鼓掌|坏笑|哈欠|鄙视|委屈|快哭了|阴险|亲亲|可怜|捂脸|破涕为笑|奸笑|机智|皱眉|耶|吃瓜|加油|天啊|Emm|社会社会|旺柴|打脸|哇|翻白眼|666|让我看看|叹气|苦涩|裂开|敬礼|笑脸|嘿哈|合十|强|弱|握手|胜利|抱拳|勾引|拳头|差劲|爱你|NO|OK|爱心|心碎|玫瑰|凋谢|拥抱|咖啡|啤酒|蛋糕|礼物|太阳|月亮|庆祝|烟花|爆竹|发|福|红包|跳跳|转圈|发抖|西瓜|猪头|便便|嘴唇|足球|篮球|乒乓|菜刀|闪电|炸弹|爱情|飞吻";
    private static readonly Regex FacePattern = new(@"\[(?:" + Faces + @")\]", RegexOptions.CultureInvariant);
    [GeneratedRegex(@"[\p{Zs}\t\f\v]+")]
    private static partial Regex HorizontalSpace();
    public static string Clean(string value)
    {
        var output = new StringBuilder(); var elements = StringInfo.GetTextElementEnumerator(value.Normalize(NormalizationForm.FormC));
        while (elements.MoveNext())
        {
            var element = elements.GetTextElement();
            if (element.EnumerateRunes().Any(r => r.Value is >= 0x1f000 and <= 0x1faff or >= 0x2600 and <= 0x27bf or 0xfe0f or 0x200d) || element.Contains('\u20e3')) continue;
            output.Append(element);
        }
        return NormalizeSpacing(FacePattern.Replace(output.ToString(), ""));
    }
    public static string NormalizeSpacing(string value)
    {
        return string.Join('\n', value.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n').Select(line =>
        {
            var runes = HorizontalSpace().Replace(line, " ").Trim().EnumerateRunes().ToArray(); var output = new StringBuilder();
            for (var i = 0; i < runes.Length; i++)
            {
                if (runes[i].Value == ' ' && (i == 0 || i == runes.Length - 1 || IsCjk(runes[i - 1]) || IsCjk(runes[i + 1]) || IsPunctuation(runes[i - 1]) || IsPunctuation(runes[i + 1]))) continue;
                if (runes[i].Value is 0x200b or 0xfeff) continue;
                output.Append(runes[i]);
            }
            return output.ToString();
        })).Trim();
    }
    private static bool IsCjk(Rune r) => r.Value is >= 0x3400 and <= 0x9fff or >= 0x20000 and <= 0x323af or >= 0xf900 and <= 0xfaff;
    private static bool IsPunctuation(Rune r) => "，。！？；：、（）【】《》“”‘’「」『』".EnumerateRunes().Contains(r);
}
