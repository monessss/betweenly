using System.Buffers.Binary;
using System.Text.Json.Nodes;

namespace Betweenly.Shared;

public static class ImageAttachment
{
    public const int MaxBytes = 256 * 1024;
    // Browser re-encodes uploads to JPEG, removing metadata and bounding dimensions.
    public static void Validate(JsonNode? node)
    {
        if (node is null) return;
        if (node is not JsonObject image) throw Api.Invalid("图片格式无效");
        Rules.Keys(image, "dataUrl width height");
        var url = Rules.Text(image, "dataUrl", 350_000);
        const string prefix = "data:image/jpeg;base64,";
        if (!url.StartsWith(prefix, StringComparison.Ordinal)) throw Api.Invalid("请上传 JPEG 图片");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(url[prefix.Length..]); }
        catch (FormatException) { throw Api.Invalid("图片编码无效"); }
        if (bytes.Length > MaxBytes) throw new ApiException(413, "INPUT_TOO_LARGE", "处理后的图片不能超过 256KB");
        var (width, height) = Dimensions(bytes);
        if (width is < 1 or > 1600 || height is < 1 or > 1600
            || image["width"] is not JsonValue w || !w.TryGetValue<int>(out var declaredWidth) || declaredWidth != width
            || image["height"] is not JsonValue h || !h.TryGetValue<int>(out var declaredHeight) || declaredHeight != height)
            throw Api.Invalid("图片尺寸无效");
    }

    private static (int width, int height) Dimensions(byte[] bytes)
    {
        if (bytes.Length < 12 || bytes[0] != 0xff || bytes[1] != 0xd8 || bytes[^2] != 0xff || bytes[^1] != 0xd9) throw Api.Invalid("JPEG 图片无效");
        var offset = 2;
        while (offset + 4 <= bytes.Length)
        {
            if (bytes[offset++] != 0xff) break;
            while (offset < bytes.Length && bytes[offset] == 0xff) offset++;
            if (offset >= bytes.Length) break;
            var marker = bytes[offset++];
            if (marker is 0xda or 0xd9) break;
            if (marker is 0x01 or >= 0xd0 and <= 0xd8) continue;
            if (offset + 2 > bytes.Length) break;
            var length = BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(offset, 2));
            if (length < 2 || offset + length > bytes.Length) break;
            if (marker is 0xc0 or 0xc1 or 0xc2 && length >= 8)
                return (BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(offset + 5, 2)), BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(offset + 3, 2)));
            offset += length;
        }
        throw Api.Invalid("无法读取 JPEG 图片尺寸");
    }
}
