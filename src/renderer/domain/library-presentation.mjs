export const MAINTENANCE_COPY = {
  update: { title: 'Update metadata', action: 'Update metadata', complete: 'Metadata update complete', description: 'Rescan the library for added, moved, changed, or removed media.' },
  verify: { title: 'Verify metadata', action: 'Verify metadata', complete: 'Verification complete', description: 'Check whether library files match their saved metadata.' },
  thumbnails: { title: 'Generate thumbnails', action: 'Generate thumbnails', complete: 'Thumbnail generation complete', description: 'Create missing thumbnails and refresh outdated ones.' },
  'video-covers': { title: 'Generate video covers', action: 'Generate covers', complete: 'Video cover generation complete', description: 'Create first-frame previews for videos, reusing valid covers.' },
  export: { title: 'Export metadata CSV', action: 'Export CSV', complete: 'CSV export complete', description: 'Export media information and labels to a CSV file.' },
};

export function formatLibraryDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function maintenanceSummary(operation, result, error = '') {
  if (error) return { title: 'Operation failed', text: error, needsAttention: true };
  const r = result || {};
  const issueKeys = ['missing', 'extra', 'tampered', 'typeMismatch', 'probeFailed', 'probeChanged', 'readFailed', 'privacyInvalid', 'failed', 'sourceChanged'];
  const needsAttention = issueKeys.some(key => r[key] > 0) || Boolean(r.warnings?.length || r.errors?.length);
  const fields = operation === 'verify' ? [['checked', 'media checked']]
    : operation === 'export' ? [['rows', 'rows exported']]
    : operation === 'update' ? [['total', 'media'], ['rebuilt', 'rebuilt'], ['reused', 'unchanged'], ['moved', 'moved']]
    : [['generated', 'generated'], ['skipped', 'reused'], ['failed', 'failed'], ['sourceChanged', 'source changed']];
  const parts = fields.filter(([key]) => Number.isFinite(r[key])).map(([key, label]) => `${r[key].toLocaleString('en-US')} ${label}`);
  if (needsAttention) parts.push('Review the detailed report');
  else if (operation === 'verify' && issueKeys.slice(0, 8).every(key => r[key] === 0)) parts.push('No issues found');
  return { title: MAINTENANCE_COPY[operation]?.complete || 'Operation complete', text: parts.join(' · '), needsAttention };
}
