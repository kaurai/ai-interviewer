import { DIMENSION_LABELS, type InterviewFeedback, type InterviewSession } from '@ai-interviewer/shared';

const escapeCell = (value: string): string => value.replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();

export function renderFeedbackJson(feedback: InterviewFeedback): string {
  return `${JSON.stringify(feedback, null, 2)}\n`;
}

export function renderFeedbackMarkdown(session: InterviewSession, feedback: InterviewFeedback): string {
  const evidenceById = new Map(feedback.evidence.map((item) => [item.id, item]));
  const lines: string[] = [
    '# AI Interview Practice Report',
    '',
    `- Interview: \`${session.id}\``,
    `- Role: ${session.profile.role}`,
    `- Seniority: ${session.profile.seniority}`,
    `- Questions reached: ${session.askedQuestionIds.length}/${session.plan.candidateQuestionIds.length}`,
    `- Coverage: ${Math.round(feedback.coverage * 100)}%`,
    `- Overall confidence: ${feedback.overallConfidence}`,
    `- Overall score: ${feedback.overallScore === null ? 'not computed (insufficient assessed coverage)' : `${feedback.overallScore}/5`}`,
    '',
    '> Practice feedback only. This is not a hiring assessment or prediction of job readiness.',
    '',
    '## Summary',
    '',
    feedback.summary,
    '',
    '## Why these questions were selected',
    '',
  ];
  for (const selection of session.plan.selections) {
    lines.push(`- **${selection.questionId}** (${selection.topic}): ${selection.reasons.slice(0, 3).join('; ')}`);
  }

  lines.push('', '## Per-question observations', '');
  for (const observation of feedback.questionObservations) {
    lines.push(`### ${observation.questionId}`, '', observation.questionText, '');
    lines.push(`Status: **${observation.status}** · Signals: ${observation.signalsDemonstrated} demonstrated, ${observation.signalsPartial} partial, ${observation.signalsTotal} total.`);
    for (const note of observation.observations) lines.push(`- ${note}`);
    lines.push('');
  }

  lines.push('## Dimension scores', '', '| Dimension | Score | Confidence | Evidence / rationale |', '|---|---:|---|---|');
  for (const assessment of feedback.assessments) {
    const quote = assessment.evidenceIds.map((id) => evidenceById.get(id)?.quote).find(Boolean);
    const rationale = assessment.rationale ?? assessment.notAssessedReason ?? 'not assessed';
    lines.push(
      `| ${DIMENSION_LABELS[assessment.dimensionId]}${assessment.dimensionId === 'delivery' ? ' (excluded from overall)' : ''} | ${assessment.score ?? '—'} | ${assessment.confidence} | ${escapeCell(quote ? `“${quote}” — ${rationale}` : rationale)} |`,
    );
  }

  lines.push('', '## Evidence', '');
  if (feedback.evidence.length === 0) lines.push('No validated candidate evidence was available.');
  for (const item of feedback.evidence) {
    lines.push(`- **${item.id}** (${item.questionId}, ${item.turnIds.join(', ')}): “${item.quote}” — ${item.interpretation}`);
  }

  lines.push('', '## Strengths', '');
  if (feedback.topStrengths.length === 0) lines.push('Not enough validated evidence to name a strength confidently.');
  for (const strength of feedback.topStrengths) lines.push(`- ${strength.text} (${strength.evidenceIds.join(', ')})`);

  lines.push('', '## Priority improvements', '');
  if (feedback.priorityActions.length === 0) lines.push('No priority action was generated from the available evidence.');
  for (const action of feedback.priorityActions) {
    lines.push(
      `### ${action.priority}. ${action.dimensionId.replaceAll('_', ' ')}`,
      '',
      `- **Observed:** ${action.issue}`,
      `- **Why it matters:** ${action.whyItMatters}`,
      `- **Do this instead:** ${action.action}`,
      `- **Practice exercise:** ${action.exercise}`,
      `- **Success criteria:** ${action.successCriteria}`,
      `- **Retry now:** ${action.retryPrompt}`,
      '',
    );
  }

  lines.push('## Caveats', '');
  for (const caveat of feedback.caveats) lines.push(`- ${caveat}`);
  return `${lines.join('\n').trim()}\n`;
}
