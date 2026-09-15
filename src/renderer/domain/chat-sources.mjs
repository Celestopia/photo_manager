export function sourcesBefore(session, message, completionId = null) {
  const sources = new Map();
  const included = new Set(message.attempt?.includedMessageIds || []);
  for (const m of session?.messages || []) {
    if (m.id !== message.id && !included.has(m.id)) continue;
    const steps = m.attempt?.steps || [];
    const completeCalls = new Set();
    for (const step of steps) {
      if (step.kind === 'completion' && step.calls.every(c => steps.some(s => s.kind === 'tool' && s.callId === c.id))) step.calls.forEach(c => completeCalls.add(c.id));
    }
    for (const step of steps) {
      if (m.id === message.id && step.id === completionId) break;
      if (step.kind === 'tool' && (m.id === message.id || completeCalls.has(step.callId)) && step.outcome.status === 'success')
        for (const source of step.outcome.sources || []) sources.set(source.sourceId, source);
    }
    if (m.id === message.id) break;
  }
  return [...sources.values()];
}
export function webUsage(message) {
  const calls = (message.attempt?.steps || []).filter(s => s.kind === 'completion').flatMap(s => s.calls).filter(c => ['web_search', 'read_web_page'].includes(c.name));
  if (!calls.length) return '';
  const outcomes = calls.map(c => message.attempt.steps.find(s => s.kind === 'tool' && s.callId === c.id)?.outcome);
  const known = outcomes.filter(o => o?.provider === 'tavily' && o.credits !== null);
  const total = Math.round(known.reduce((n, o) => n + o.credits, 0) * 1000) / 1000;
  return `Web credits: ${known.length ? total : 'unknown'}${known.length && known.length < calls.length ? ' (incomplete)' : ''}`;
}
