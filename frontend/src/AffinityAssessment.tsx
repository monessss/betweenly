import type { ReactNode } from 'react';
import type { AffinityAssessment as Assessment } from './lib/contracts.ts';

export function AffinityAssessment({ value, evidence }: { value: Assessment; evidence: (ref: string) => ReactNode }) {
  return <section className="affinity-assessment" aria-label="好感度评估">
    <div className="affinity-score"><div><span>好感度</span><strong>{value.score === null ? '信息不足' : <>{value.score}<small>/ 100</small></>}</strong></div><span className="affinity-confidence">依据充分度 · {{ LOW: '低', MEDIUM: '中', HIGH: '高' }[value.confidence]}</span></div>
    {value.score !== null && <progress className="affinity-meter" aria-label="互动倾向评分" value={value.score} max={100} />}
    <p className="affinity-summary">{value.summary}</p>
    <p className="affinity-note">基于所选互动记录，不代表对方真实想法。</p>
    {value.evidence.length > 0 && <section className="document-section affinity-evidence"><h4>依据</h4>{value.evidence.map((item, index) => <div className="affinity-signal" key={index}><span className={'affinity-signal-label ' + item.signal.toLowerCase()}>{{ POSITIVE: '积极', NEGATIVE: '消极', AMBIGUOUS: '模糊' }[item.signal]}</span><p>{item.description}</p><div>{item.evidenceRefs.map(evidence)}</div></div>)}</section>}
  </section>;
}
