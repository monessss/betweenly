using System.Text.Json.Nodes;
using Betweenly.Shared;

internal static class TextImports
{
    public static Task<JsonObject> Commit(HttpContext c, string contactId, JsonObject input, JsonStore store)
    {
        Rules.Keys(input, "importId messages");
        var importId = Api.Uuid(Rules.Text(input, "importId", 36));
        var messages = Rules.Array(input, "messages", 1000);
        if (messages.Count == 0) throw Api.Invalid("至少选择一条消息");
        var accepted = messages.Select(node =>
        {
            var item = node as JsonObject ?? throw Api.Invalid(); Rules.Keys(item, "sender text sentAt");
            Rules.Enum(item, "sender", "USER OTHER UNKNOWN"); Rules.Text(item, "text", 4000); Rules.Date(item, "sentAt");
            var sender = item["sender"]!.GetValue<string>();
            return Rules.Input("messages", new JsonObject
            {
                ["sender"] = sender, ["text"] = item["text"]!.DeepClone(), ["sentAt"] = item["sentAt"]?.DeepClone(), ["sequenceNo"] = null,
                ["sourceType"] = sender == "OTHER" ? "COUNTERPART_EXPLICIT" : sender == "USER" ? "USER_SELF_REPORT" : "USER_RELAY",
                ["isVerbatim"] = sender != "UNKNOWN"
            });
        }).ToArray();
        var user = Api.User(c); var hash = Api.Hash(input);
        return store.Write(s =>
        {
            JsonStore.Get(s, "contacts", contactId, user);
            if (JsonStore.Rows(s)["text-imports/" + importId] is not null)
            {
                var old = JsonStore.Get(s, "text-imports", importId, user);
                if (old["contactId"]!.GetValue<string>() != contactId) throw Api.Missing();
                if (old["requestHash"]!.GetValue<string>() != hash) throw new ApiException(409, "IDEMPOTENCY_KEY_REUSED", "该批次已使用其他内容导入，请重新解析");
                var replay = (JsonObject)old["result"]!.DeepClone(); replay["importedCount"] = 0; replay["skippedCount"] = accepted.Length; return replay;
            }
            var ids = new JsonArray();
            foreach (var message in accepted)
            {
                var id = Api.NewId(); JsonStore.Put(s, "messages", id, user, Api.Stamp(message, "messageId", id, contactId)); ids.Add(id);
            }
            var result = new JsonObject { ["importId"] = importId, ["contactId"] = contactId, ["importedCount"] = accepted.Length, ["skippedCount"] = 0, ["messageIds"] = ids };
            JsonStore.Put(s, "text-imports", importId, user, new JsonObject { ["contactId"] = contactId, ["requestHash"] = hash, ["result"] = result.DeepClone() });
            return result;
        });
    }
}
