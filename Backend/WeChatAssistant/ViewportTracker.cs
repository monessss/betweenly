namespace Betweenly.WeChatAssistant;

internal static class ViewportTracker
{
    internal sealed record Seen(Program.TextTarget Target, string? Text);

    // An upward scroll moves the same pixels downward. Require that physical overlap;
    // equal message text alone cannot identify a message (e.g. two separate "收到").
    public static int? DownwardShift(Bitmap previous, Bitmap current)
    {
        if (previous.Size != current.Size) return null;
        var width = previous.Width; var height = previous.Height;
        var oldPixels = new Color[width * height]; var newPixels = new Color[width * height];
        for (var y = 0; y < height; y++) for (var x = 0; x < width; x++)
        { oldPixels[y * width + x] = previous.GetPixel(x,y); newPixels[y * width + x] = current.GetPixel(x,y); }
        var features = new List<(int X, int Y)>();
        for (var y = 4; y < height-4; y += 6) for (var x = 8; x < width-8; x += 8)
            if (Distance(oldPixels[y*width+x],oldPixels[y*width+x+4]) > 50 || Distance(oldPixels[y*width+x],oldPixels[(y+3)*width+x]) > 50) features.Add((x,y));
        if (features.Count < 30) return null;
        var scores = new List<(int Shift, double Score, double Match)>();
        for (var shift = 0; shift <= height * .72; shift++)
        {
            long distance = 0; var count = 0; var matches = 0;
            foreach (var (x,y) in features)
            {
                if (y+shift >= height-4) continue;
                var d = Distance(oldPixels[y*width+x],newPixels[(y+shift)*width+x]);
                distance += Math.Min(d,180); count++; if (d < 45) matches++;
            }
            if (count >= 30) scores.Add((shift,(double)distance/count,(double)matches/count));
        }
        if (scores.Count == 0) return null;
        var best = scores.MinBy(s => s.Score);
        if (best.Match < .85 || best.Score > 24) return null;
        // Repeated visual patterns without a distinct match are unsafe to stitch.
        if (scores.Any(s => Math.Abs(s.Shift-best.Shift) > 8 && s.Score <= best.Score+2 && s.Match >= best.Match-.01)) return null;
        return best.Shift;
    }

    public static Seen? FindPrevious(IEnumerable<Seen> previous, Program.TextTarget target, int shift, double scale)
    {
        var tolerance = 5 * scale;
        return previous.FirstOrDefault(old => old.Target.Sender == target.Sender
            && Math.Abs(old.Target.Bounds.Left-target.Bounds.Left) <= tolerance
            && Math.Abs(old.Target.Bounds.Right-target.Bounds.Right) <= tolerance
            && (Math.Abs(old.Target.Bounds.Top+shift-target.Bounds.Top) <= tolerance
                || Math.Abs(old.Target.Bounds.Bottom+shift-target.Bounds.Bottom) <= tolerance));
    }
    private static int Distance(Color a, Color b) => Math.Abs(a.R-b.R)+Math.Abs(a.G-b.G)+Math.Abs(a.B-b.B);
}
