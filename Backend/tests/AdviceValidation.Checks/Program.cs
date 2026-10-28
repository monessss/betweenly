using System.Text.Json.Nodes;
using Betweenly.Shared;

JsonObject Input() => JsonNode.Parse("""
{"userGoal":"ASSESS_AFFINITY","draftText":null,"context":{"messages":[{"messageId":"15c85a6a-c639-45a1-9c41-bdcde743ba79","sender":"OTHER"}],"events":[],"preferenceRecords":[]}}
""")!.AsObject();
JsonObject Output() => JsonNode.Parse("""
{"schemaVersion":"1.0","status":"OK","contextUsedRefs":["message:15c85a6a-c639-45a1-9c41-bdcde743ba79"],"observations":[],"uncertainties":[],"recommendation":{"actionType":"NO_ACTION","title":"好感度评估","reason":"对方提出邀约。","evidenceRefs":["message:15c85a6a-c639-45a1-9c41-bdcde743ba79"],"actionTags":[],"appliesWhen":null,"alternatives":[]},"replyOptions":[],"draftRevision":null,"responseHandling":[],"clarifyingQuestions":[],"engineVersion":"test","createdAt":"2026-10-25T00:00:00Z","affinityAssessment":{"score":68,"confidence":"MEDIUM","summary":"互动较积极。","evidence":[{"signal":"POSITIVE","description":"对方提出了具体邀约。","evidenceRefs":["message:15c85a6a-c639-45a1-9c41-bdcde743ba79"]}],"uncertainties":["也可能是普通朋友之间的交流。"]}}
""")!.AsObject();
void Valid(JsonObject output, JsonObject input, string label) { AdviceValidation.Validate(output,input); Console.WriteLine("PASS "+label); }
void Invalid(Action<JsonObject,JsonObject> change, string label)
{
    var output=Output();var input=Input();change(output,input);
    try { AdviceValidation.Validate(output,input); } catch(ApiException e) when(e.Code=="MODEL_OUTPUT_INVALID") { Console.WriteLine("PASS "+label);return; }
    throw new Exception(label);
}
Valid(Output(),Input(),"scored assessment accepts evidence and uncertainty");
foreach(var score in new[]{0,100}) { var output=Output();output["affinityAssessment"]!["score"]=score;Valid(output,Input(),"inclusive score boundary "+score); }
foreach(var score in new[]{-1d,101d,68.5}) Invalid((o,_)=>o["affinityAssessment"]!["score"]=score,"invalid score rejected "+score);
Invalid((o,_)=>o["affinityAssessment"]!["score"]=true,"boolean score rejected");
Invalid((o,_)=>o["affinityAssessment"]!["uncertainties"]=new JsonArray(),"missing uncertainty rejected");
Invalid((o,_)=>o["affinityAssessment"]!["evidence"]![0]!["evidenceRefs"]=new JsonArray("message:unknown"),"foreign evidence rejected");
Invalid((_,i)=>i["context"]!["messages"]![0]!["sender"]="USER","user-only evidence cannot establish counterpart affinity");
Invalid((o,_)=>o["recommendation"]!["actionType"]="ASK_FOLLOW_UP","assessment cannot generate contact instructions");
Invalid((o,_)=>o.Remove("affinityAssessment"),"missing assessment rejected for assessment goal");
Invalid((_,i)=>i["userGoal"]="CONTINUE_CONVERSATION","unrequested assessment rejected");
var missing=Output();missing["status"]="NEEDS_CONTEXT";missing["recommendation"]=null;missing["affinityAssessment"]!["score"]=null;missing["affinityAssessment"]!["confidence"]="LOW";
missing["clarifyingQuestions"]=new JsonArray(new JsonObject{["question"]="对方最近主动聊过什么？",["reason"]="需要更多互动记录。",["fieldHint"]="MESSAGE_CONTENT"});
Valid(missing,Input(),"insufficient information retains null score");
var legacy=Output();legacy.Remove("affinityAssessment");var legacyInput=Input();legacyInput["userGoal"]="CONTINUE_CONVERSATION";Valid(legacy,legacyInput,"legacy advice remains compatible");

JsonObject Message(string text,string sender="USER",string? contact=null) => new(){["messageId"]=Guid.NewGuid().ToString(),["contactId"]=contact??"same",["sender"]=sender,["text"]=text,["createdAt"]="2026-10-25T00:00:00Z",["isVerbatim"]=true};
var samples=new[]{Message("哈哈可以"),Message("那你先歇会"),Message("好嘞"),Message("我晚点再看"),Message("行啊"),Message("哈哈好"),Message("别学我说话","OTHER"),Message("陌生人的话",contact:"other"),Message("https://example.com/private"),Message("验证码1234"),Message("me@example.com"),Message("[动画表情]")};
var learned=WritingStyleLearning.Build(samples,"same");
void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS "+label);}
Check(learned["sampleCount"]!.GetValue<int>()==6,"learning excludes counterpart, foreign contact, credentials and attachments");
Check(learned["medianLength"]!.GetValue<int>()<=6,"short utterances determine the learned length");
Check(!learned["examples"]!.AsArray().Any(e=>e!.GetValue<string>()=="别学我说话"),"counterpart voice never becomes the user's voice");
Check(WritingStyleLearning.Build(samples.Skip(1),"same")["sampleCount"]!.GetValue<int>()==5,"removing source messages removes their style reference");
var many=WritingStyleLearning.Build(Enumerable.Range(0,120).Select(i=>Message("聊天例句"+i)),"same");
Check(many["sampleCount"]!.GetValue<int>()==80 && many["examples"]!.AsArray().Count==12,"automatic learning has bounded history and examples");
var oldStyle=new JsonObject{["preferredLength"]="SHORT",["emojiPreference"]="AVOID",["preferredTones"]=new JsonArray("NEUTRAL"),["avoidPatterns"]=new JsonArray(),["examplePhrases"]=new JsonArray()};
Check(Rules.Input("style",oldStyle)["learnFromMessages"]!.GetValue<bool>(),"legacy style inputs default to automatic reference");
oldStyle["learnFromMessages"]=false;Check(!Rules.Input("style",oldStyle)["learnFromMessages"]!.GetValue<bool>(),"explicit learning opt-out is preserved");
Check(oldStyle["usePersonalCorpus"]!.GetValue<bool>(), "legacy style enables personal corpus without breaking old inputs");
var voiceState = new JsonObject { ["rows"] = new JsonObject(), ["epochs"] = new JsonObject() };
var voiceUser = Api.NewId(); var voiceOther = Api.NewId();
JsonObject Voice(string text, string situation = "GENERAL") => new() { ["text"] = text, ["situation"] = situation };
JsonObject Batch(params JsonObject[] values) => new() { ["confirmedOwnWords"] = true, ["samples"] = new JsonArray(values.Select(v => (JsonNode?)v.DeepClone()).ToArray()) };
PersonalVoice.Import(voiceState, voiceUser, Batch(Voice("先休息会吧", "CARE"), Voice("周末出来走走？", "INVITATION"), Voice("行  先这样"), Voice("行 先这样")));
Check(PersonalVoice.Status(voiceState, voiceUser)["sampleCount"]!.GetValue<int>() == 3, "personal corpus deduplicates normalized own expressions");
var picked = PersonalVoice.Select(voiceState, voiceUser, "CONTINUE_CONVERSATION", "今天汇报搞砸了，有点难受");
Check(picked["examples"]![0]!["situation"]!.GetValue<string>() == "CARE", "relevant care samples rank before general expressions");
Check(!picked["examples"]!.AsArray().Any(s => s!["situation"]!.GetValue<string>() == "INVITATION"), "unrelated invitations do not become comfort samples");
Check(PersonalVoice.Select(voiceState, voiceOther, "CONTINUE_CONVERSATION", "难受")["examples"]!.AsArray().Count == 0, "personal corpus never crosses users");
var revisionBefore = PersonalVoice.Revision(voiceState, voiceUser);
PersonalVoice.Import(voiceState, voiceUser, Batch(Voice("先休息会吧", "CARE")));
Check(PersonalVoice.Revision(voiceState, voiceUser) == revisionBefore, "repeated imports do not change corpus version");
PersonalVoice.Changed(voiceState, voiceUser, true);
Check(JsonStore.Epoch(voiceState, voiceUser) == 1 && JsonStore.Epoch(voiceState, voiceOther) == 0, "destructive changes advance only the owner's privacy version");
var badBatch = Batch(Voice("valid"), Voice("invalid", "INVALID"));
try { PersonalVoice.Import(voiceState, voiceUser, badBatch); throw new Exception("invalid batch accepted"); } catch (ApiException e) when (e.Status == 400) { }
Check(PersonalVoice.Status(voiceState, voiceUser)["sampleCount"]!.GetValue<int>() == 3, "invalid batch leaves all corpus rows untouched");
for (var i = 3; i < PersonalVoice.Capacity; i++) { var id = Api.NewId(); JsonStore.Put(voiceState, "voice", id, voiceUser, Api.Stamp(Voice("sample " + i), "sampleId", id)); }
try { PersonalVoice.Import(voiceState, voiceUser, Batch(Voice("overflow"))); throw new Exception("capacity exceeded"); } catch (ApiException e) when (e.Status == 422) { }
Check(PersonalVoice.Status(voiceState, voiceUser)["sampleCount"]!.GetValue<int>() == PersonalVoice.Capacity, "capacity rejects new examples without dropping existing data");
Check(PersonalVoice.Select(voiceState, voiceUser, "CONTINUE_CONVERSATION", "sample")["examples"]!.AsArray().Count <= 8, "large corpora send at most eight selected examples");
