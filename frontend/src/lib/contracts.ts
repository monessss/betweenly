export type Stage = 'JUST_CONNECTED' | 'ACQUAINTED' | 'ONGOING_CONTACT' | 'PLANNING_MEETING' | 'UNCLEAR';
export type Source = 'COUNTERPART_EXPLICIT' | 'USER_SELF_REPORT' | 'USER_RELAY' | 'OBSERVED_BEHAVIOR' | 'MODEL_INFERENCE';
export type Sender = 'USER' | 'OTHER' | 'UNKNOWN';
export type Entry = 'NEW_CONNECTION' | 'BUILD_RELATIONSHIP' | 'SPECIFIC_DIFFICULTY';
export type Goal = 'START_CONTACT' | 'CONTINUE_CONVERSATION' | 'EXTEND_TOPIC' | 'PROPOSE_INVITATION' | 'PREPARE_MEETING' | 'EXPRESS_INTEREST' | 'CLARIFY_MISUNDERSTANDING' | 'APOLOGIZE' | 'END_CONVERSATION' | 'DECIDE_NEXT_STEP' | 'REVIEW_INTERACTION' | 'ASSESS_AFFINITY' | 'OTHER';
export type Category = 'INTEREST' | 'COMMUNICATION_STYLE' | 'HUMOR' | 'BOUNDARY' | 'CURRENT_CONTEXT';
export type Boundary = 'DO_NOT_CONTACT_AGAIN' | 'DO_NOT_USE_NICKNAME' | 'DO_NOT_DISCUSS_TOPIC' | 'DO_NOT_MENTION_LOCATION' | 'DO_NOT_PUBLICLY_MENTION' | 'NO_PHYSICAL_CONTACT' | 'OTHER';
export type EventType = 'MET_IN_PERSON' | 'SHARED_EXPERIENCE' | 'INVITATION_MADE' | 'INVITATION_ACCEPTED' | 'INVITATION_DECLINED' | 'NO_RESPONSE' | 'CONVERSATION_ENDED' | 'USER_ACTION' | 'OTHER';
export interface Versioned { version: number; createdAt: string; updatedAt: string }
export interface ContactInput { label: string; relationshipStage: Stage; connectionContext: string | null; currentSituation: string | null }
export interface Contact extends ContactInput, Versioned { contactId: string }
export interface MessageImage { dataUrl: string; width: number; height: number }
export interface MessageInput { sender: Sender; text: string; sentAt: string | null; sequenceNo: number | null; sourceType: Exclude<Source, 'MODEL_INFERENCE'>; isVerbatim: boolean; image?: MessageImage | null }
export interface Message extends MessageInput, Versioned { messageId: string; contactId: string }
export interface EventInput { eventType: EventType; whatHappened: string; occurredAt: string | null; sourceType: Exclude<Source, 'MODEL_INFERENCE'>; userReflection: string | null; relatedAdviceId: string | null }
export interface Event extends EventInput, Versioned { eventId: string; contactId: string }
export interface PreferenceInput { subject: 'USER' | 'COUNTERPART'; category: Category; statement: string; boundaryRule: Boundary | null; appliesWhen: string | null; sourceType: Source; sourceRefs: string[]; supersedesRecordId: string | null }
export interface Preference extends PreferenceInput, Versioned { recordId: string; contactId: string; status: 'PENDING' | 'CONFIRMED' | 'SUPERSEDED' | 'REJECTED'; hardConstraint: boolean }
export interface StyleInput { preferredLength: 'SHORT' | 'MEDIUM' | 'AS_NEEDED'; emojiPreference: 'AVOID' | 'NEUTRAL' | 'SPARSE'; preferredTones: ('NEUTRAL' | 'WARM' | 'PLAYFUL' | 'DIRECT' | 'FORMAL')[]; avoidPatterns: string[]; examplePhrases: string[]; learnFromMessages?: boolean; usePersonalCorpus?: boolean }
export interface WritingStyle { contactId: string; sampleCount: number; verbatimSampleCount: number; medianLength: number; questionRate: number; emojiObserved: boolean; patterns: string[]; examples: string[]; sourceMessageIds: string[] }
export interface Style extends StyleInput { userId: string; version: number; updatedAt: string }
export interface AdviceInput { entryPoint: Entry; userGoal: Goal; specificQuestion: string | null; selectedMessageIds: string[]; selectedEventIds: string[]; selectedPreferenceIds: string[]; draftText: string | null; ephemeralContext: null }
export interface Recommendation { actionType: string; title: string; reason: string; evidenceRefs: string[]; actionTags: string[]; appliesWhen: string | null; alternatives: { actionType: string; title: string; appliesWhen: string; actionTags: string[] }[] }
export interface AffinityAssessment { score: number | null; confidence: 'LOW' | 'MEDIUM' | 'HIGH'; summary: string; evidence: { signal: 'POSITIVE' | 'NEGATIVE' | 'AMBIGUOUS'; description: string; evidenceRefs: string[] }[]; uncertainties: string[] }
interface AdviceBase { requestId: string; contactId: string; schemaVersion: '1.0'; contextUsedRefs: string[]; observations: { statement: string; kind: 'FACT' | 'INFERENCE'; evidenceRefs: string[] }[]; uncertainties: string[]; affinityAssessment?: AffinityAssessment | null; draftRevision: { text: string; changes: string[] } | null; responseHandling: { scenario: 'ACCEPTS' | 'AMBIGUOUS' | 'DECLINES' | 'NO_RESPONSE'; guidance: string }[]; clarifyingQuestions: { question: string; reason: string; fieldHint: string }[]; engineVersion: string; createdAt: string }
export interface Reply { optionId: string; text: string; style: string; evidenceRefs: string[]; appliesWhen: string | null }
export type Advice = AdviceBase & (
  { status: 'OK'; recommendation: Recommendation; replyOptions: Reply[] } |
  { status: 'NEEDS_CONTEXT'; recommendation: null; replyOptions: []; draftRevision: null } |
  { status: 'CANNOT_ADVISE'; recommendation: null; replyOptions: []; draftRevision: null; cannotAdviseReason: { code: string; message: string } }
);
export interface Envelope<T> { data: T; meta: { nextCursor?: string | null }; traceId: string }
export interface RequestOptions { method?: string; body?: unknown; version?: number; idempotencyKey?: string; signal?: AbortSignal; anonymous?: boolean }
export interface Transport { request<T>(path: string, options?: RequestOptions): Promise<Envelope<T>> }
export interface Settings { baseUrl: string; devUserId: string; token: string }
export const stages: Record<Stage, string> = { JUST_CONNECTED: '刚刚认识', ACQUAINTED: '已经相识', ONGOING_CONTACT: '持续联系', PLANNING_MEETING: '计划见面', UNCLEAR: '还不确定' };
export const sources: Record<Source, string> = { COUNTERPART_EXPLICIT: '对方明确表达', USER_SELF_REPORT: '我的自述', USER_RELAY: '我的转述', OBSERVED_BEHAVIOR: '观察到的行为', MODEL_INFERENCE: '待确认推测' };
export const goals: Record<Goal, string> = { ASSESS_AFFINITY: '好感度评估', START_CONTACT: '自然开始联系', CONTINUE_CONVERSATION: '接住这段对话', EXTEND_TOPIC: '延续一个话题', PROPOSE_INVITATION: '提出一次邀请', PREPARE_MEETING: '准备线下见面', EXPRESS_INTEREST: '表达我的意愿', CLARIFY_MISUNDERSTANDING: '澄清一个误会', APOLOGIZE: '认真说声抱歉', END_CONVERSATION: '自然结束对话', DECIDE_NEXT_STEP: '想清楚下一步', REVIEW_INTERACTION: '回顾这次互动', OTHER: '其他目标' };
export const categories: Record<Category, string> = { INTEREST: '兴趣偏好', COMMUNICATION_STYLE: '沟通习惯', HUMOR: '玩笑偏好', BOUNDARY: '明确边界', CURRENT_CONTEXT: '当前情境' };
export const boundaries: Record<Boundary, string> = { DO_NOT_CONTACT_AGAIN: '不要再联系', DO_NOT_USE_NICKNAME: '不要使用昵称', DO_NOT_DISCUSS_TOPIC: '不要谈论某话题', DO_NOT_MENTION_LOCATION: '不要提及某地点', DO_NOT_PUBLICLY_MENTION: '不要在公开场合提及', NO_PHYSICAL_CONTACT: '不要身体接触', OTHER: '其他明确边界' };
export const eventTypes: Record<EventType, string> = { MET_IN_PERSON: '线下见面', SHARED_EXPERIENCE: '共同经历', INVITATION_MADE: '发出邀请', INVITATION_ACCEPTED: '邀请被接受', INVITATION_DECLINED: '邀请被拒绝', NO_RESPONSE: '没有回应', CONVERSATION_ENDED: '结束对话', USER_ACTION: '我的行动', OTHER: '其他事件' };
