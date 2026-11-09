// Order valid plans by execution conditions before directional indicators.
function rank(row) {
  const direction = row.direction ?? (row.plan?.side === 'long' ? 1 : row.plan?.side === 'short' ? -1 : 0);
  if (!direction || !['ready', 'watch', 'structure'].includes(row.state)) return [4, 0, 0, 0, 0];
  const group = row.state === 'ready' ? 0 : row.state === 'watch' ? 2 : row.structure_confirmed ? 1 : 3;
  const distance = Number.isFinite(row.entry_distance_atr) ? row.entry_distance_atr : Number.MAX_VALUE;
  const netRR = row.state !== 'structure' && Number.isFinite(row.net_rr) ? row.net_rr : 0;
  const momentum = Number.isFinite(row.momentum) ? row.momentum * direction : 0;
  const crosses = Object.values(row.crosses || {}).filter(value => value === direction).length;
  return [group, distance, -netRR, -momentum, -crosses];
}

export function compareOpportunities(a, b) {
  const left = rank(a), right = rank(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}
