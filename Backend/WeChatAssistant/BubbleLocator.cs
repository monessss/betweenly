namespace Betweenly.WeChatAssistant;

internal static class BubbleLocator
{
    // Find flat bubble backgrounds, not glyphs. A character never needs to be recognized to copy its message.
    public static List<Program.TextTarget> Find(Bitmap image, double scale)
    {
        const int step = 2;
        var width = (image.Width + step - 1) / step; var height = (image.Height + step - 1) / step;
        var pixels = new Color[width * height]; var histogram = new Dictionary<int, int>();
        for (var y = 0; y < height; y++) for (var x = 0; x < width; x++)
        {
            var c = image.GetPixel(x * step, y * step); pixels[y * width + x] = c;
            var key = Key(c); histogram[key] = histogram.GetValueOrDefault(key) + 1;
        }
        var backgroundKey = histogram.MaxBy(p => p.Value).Key;
        var background = pixels.First(c => Key(c) == backgroundKey);
        var visited = new bool[pixels.Length]; var queue = new Queue<int>(); var targets = new List<Program.TextTarget>();
        for (var start = 0; start < pixels.Length; start++)
        {
            if (visited[start]) continue;
            visited[start] = true; var color = pixels[start];
            var green = color.G > color.R + 35 && color.G > color.B + 20;
            if (Distance(color, background) < 18 || !green && Math.Max(color.R, Math.Max(color.G, color.B)) - Math.Min(color.R, Math.Min(color.G, color.B)) > 16) continue;
            queue.Enqueue(start); var count = 0; var left = width; var right = 0; var top = height; var bottom = 0; var hit = start;
            while (queue.TryDequeue(out var index))
            {
                count++; var x = index % width; var y = index / width;
                if (x < left) { left = x; hit = index; } right = Math.Max(right, x); top = Math.Min(top, y); bottom = Math.Max(bottom, y);
                foreach (var next in new[] { x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1 })
                    if (next >= 0 && !visited[next] && Distance(pixels[next], color) < 16) { visited[next] = true; queue.Enqueue(next); }
            }
            var bounds = Rectangle.FromLTRB(left * step, top * step, (right + 1) * step, (bottom + 1) * step);
            if (bounds.Left < 45 * scale || bounds.Right > image.Width - 45 * scale || bounds.Width < 24 * scale || bounds.Height < 22 * scale || bounds.Width > image.Width * .85 || bounds.Height > image.Height * .8 || count < (right-left+1)*(bottom-top+1)*.4) continue;
            // Avatars and centered cards may have a flat area too; the text-only menu/clipboard check is authoritative.
            var sender = green ? "USER" : bounds.Left < 130 * scale ? "OTHER" : "UNKNOWN";
            var center = new Point((left + right) * step / 2, (top + bottom) * step / 2);
            var nearest = Enumerable.Range(0, bounds.Height / step).Select(y => (top + y) * width + Math.Clamp(center.X / step, left, right)).Where(i => Distance(pixels[i], color) < 16).OrderBy(i => Math.Abs(i / width * step - center.Y)).FirstOrDefault(hit);
            targets.Add(new Program.TextTarget(bounds, new Point(nearest % width * step, nearest / width * step), sender));
        }
        return targets.OrderBy(t => t.Bounds.Top).ThenBy(t => t.Bounds.Left).ToList();
    }
    private static int Key(Color c) => (c.R / 4 << 16) | (c.G / 4 << 8) | c.B / 4;
    private static int Distance(Color a, Color b) => Math.Abs(a.R-b.R)+Math.Abs(a.G-b.G)+Math.Abs(a.B-b.B);
}
