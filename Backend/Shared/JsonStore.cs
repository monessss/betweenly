using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Betweenly.Shared;

// One process per store. Copy-on-write + flushed atomic replacement; each service owns its file.
public sealed class JsonStore : IDisposable
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly FileStream processLock;
    private readonly string path;
    private JsonObject state;
    public JsonStore(string name)
    {
        var directory = Path.GetFullPath(Api.Env("DATA_DIRECTORY", Path.Combine(AppContext.BaseDirectory, "data")));
        Directory.CreateDirectory(directory); path = Path.Combine(directory, name + ".json");
        processLock = new FileStream(path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        state = File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path)) as JsonObject ?? throw new InvalidOperationException("Invalid store") : new JsonObject();
        state["rows"] ??= new JsonObject(); state["idempotency"] ??= new JsonObject(); state["epochs"] ??= new JsonObject();
        // Probe writability even for empty stores; readiness is not merely process liveness.
        Save(state);
    }
    public async Task<T> Read<T>(Func<JsonObject, T> action)
    {
        await gate.WaitAsync(); try { return action((JsonObject)state.DeepClone()); } finally { gate.Release(); }
    }
    public async Task<T> Write<T>(Func<JsonObject, T> action)
    {
        await gate.WaitAsync();
        try { var next = (JsonObject)state.DeepClone(); var result = action(next); Save(next); state = next; return result; }
        finally { gate.Release(); }
    }
    private void Save(JsonObject next)
    {
        var temp = path + ".tmp";
        using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        { var bytes = Encoding.UTF8.GetBytes(next.ToJsonString()); stream.Write(bytes); stream.Flush(true); }
        File.Move(temp, path, true);
    }
    public static JsonObject Rows(JsonObject s) => (JsonObject)s["rows"]!;
    public static IEnumerable<JsonObject> Owned(JsonObject s, string collection, string user, bool pending = false) => Rows(s)
        .Where(p => p.Key.StartsWith(collection + "/", StringComparison.Ordinal) && p.Value!["owner"]!.GetValue<string>() == user && (pending || p.Value!["pending"] is null))
        .Select(p => (JsonObject)p.Value!["value"]!.DeepClone());
    public static JsonObject Get(JsonObject s, string collection, string id, string user, bool pending = false)
    {
        var row = Rows(s)[collection + "/" + Api.Uuid(id)] as JsonObject;
        if (row is null || row["owner"]!.GetValue<string>() != user || (!pending && row["pending"] is not null)) throw Api.Missing();
        return (JsonObject)row["value"]!.DeepClone();
    }
    public static void Put(JsonObject s, string collection, string id, string user, JsonObject value) => Rows(s)[collection + "/" + id] = new JsonObject { ["owner"] = user, ["value"] = value.DeepClone() };
    public static long Epoch(JsonObject s, string user) => s["epochs"]![user]?.GetValue<long>() ?? 0;
    public static void Bump(JsonObject s, string user) => s["epochs"]![user] = Epoch(s, user) + 1;
    public static JsonObject Row(JsonObject s, string collection, string id) => (JsonObject)Rows(s)[collection + "/" + id]!;
    public void Dispose() { processLock.Dispose(); gate.Dispose(); }
}
