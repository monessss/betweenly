import { ApiError, isUuid } from './api.ts';
import type { Advice } from './contracts.ts';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function texts(value: unknown): value is string[] { return Array.isArray(value) && value.every(text); }
function nullableText(value: unknown) { return value === null || text(value); }

// Protect rendering from incomplete or incompatible responses. Business/evidence validation belongs to the services.
export function assertAdvice(value: unknown, contactId: string, expectAffinity = false): asserts value is Advice {
  const invalid = () => { throw new ApiError('建议结果不符合契约，未展示该内容', 'MODEL_OUTPUT_INVALID'); };
  if (!object(value) || value.schemaVersion !== '1.0' || !text(value.requestId) || !isUuid(value.requestId) || value.contactId !== contactId || !text(value.engineVersion) || !text(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || !texts(value.contextUsedRefs) || !texts(value.uncertainties)) return invalid();
  if (expectAffinity && !object(value.affinityAssessment)) return invalid();
  if (!Array.isArray(value.observations) || !value.observations.every(item => object(item) && text(item.statement) && ['FACT', 'INFERENCE'].includes(String(item.kind)) && texts(item.evidenceRefs) && (item.kind !== 'FACT' || item.evidenceRefs.length > 0))) return invalid();
  if (!Array.isArray(value.replyOptions) || value.replyOptions.length > 3 || !value.replyOptions.every(item => object(item) && text(item.optionId) && text(item.text) && item.text.length <= 1000 && text(item.style) && texts(item.evidenceRefs) && nullableText(item.appliesWhen))) return invalid();
  if (!Array.isArray(value.clarifyingQuestions) || !value.clarifyingQuestions.every(item => object(item) && text(item.question) && text(item.reason) && text(item.fieldHint))) return invalid();
  if (!Array.isArray(value.responseHandling) || !value.responseHandling.every(item => object(item) && ['ACCEPTS', 'AMBIGUOUS', 'DECLINES', 'NO_RESPONSE'].includes(String(item.scenario)) && text(item.guidance))) return invalid();
  if (value.draftRevision !== null && !(object(value.draftRevision) && text(value.draftRevision.text) && texts(value.draftRevision.changes) && value.draftRevision.changes.length <= 3)) return invalid();
  if (value.affinityAssessment !== undefined && value.affinityAssessment !== null) {
    const a = value.affinityAssessment;
    if (!object(a) || !['LOW', 'MEDIUM', 'HIGH'].includes(String(a.confidence)) || !text(a.summary) || a.summary.length > 500 || !texts(a.uncertainties) || a.uncertainties.length === 0 || a.uncertainties.length > 8 || !Array.isArray(a.evidence) || a.evidence.length > 8) return invalid();
    if (!a.evidence.every(item => object(item) && ['POSITIVE', 'NEGATIVE', 'AMBIGUOUS'].includes(String(item.signal)) && text(item.description) && texts(item.evidenceRefs) && item.evidenceRefs.length > 0 && item.evidenceRefs.every(ref => (value.contextUsedRefs as string[]).includes(ref)))) return invalid();
    if (a.score === null) { if (value.status === 'OK' || a.confidence !== 'LOW') return invalid(); }
    else if (typeof a.score !== 'number' || !Number.isInteger(a.score) || a.score < 0 || a.score > 100 || value.status !== 'OK' || a.evidence.length === 0) return invalid();
    if (value.status === 'OK' && (value.replyOptions.length > 0 || value.draftRevision !== null || value.responseHandling.length > 0 || !object(value.recommendation) || value.recommendation.actionType !== 'NO_ACTION' || !Array.isArray(value.recommendation.actionTags) || value.recommendation.actionTags.length > 0 || !Array.isArray(value.recommendation.alternatives) || value.recommendation.alternatives.length > 0)) return invalid();
  }
  if (value.status === 'OK') {
    const recommendation = value.recommendation;
    if (!object(recommendation) || !text(recommendation.title) || !text(recommendation.reason) || !text(recommendation.actionType) || !texts(recommendation.evidenceRefs) || !texts(recommendation.actionTags) || !nullableText(recommendation.appliesWhen) || !Array.isArray(recommendation.alternatives) || recommendation.alternatives.length > 2 || !recommendation.alternatives.every(item => object(item) && text(item.title) && text(item.appliesWhen) && text(item.actionType) && texts(item.actionTags))) return invalid();
  } else {
    if (value.recommendation !== null || value.replyOptions.length !== 0 || value.draftRevision !== null) return invalid();
    if (value.status === 'NEEDS_CONTEXT') { if (value.clarifyingQuestions.length === 0) return invalid(); }
    else if (value.status !== 'CANNOT_ADVISE' || !object(value.cannotAdviseReason) || !text(value.cannotAdviseReason.code) || !text(value.cannotAdviseReason.message)) return invalid();
  }
}
