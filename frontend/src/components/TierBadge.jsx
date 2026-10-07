const LABELS = {
  high: { text: 'Confident', cls: 'tier-high' },
  medium: { text: 'Not fully sure', cls: 'tier-medium' },
  low: { text: 'Unreliable', cls: 'tier-low' },
  unknown: { text: 'Not recognized', cls: 'tier-unknown' },
}

/** Visualizes the Calibrated Trust Core decision so the UI never over-claims. */
export default function TierBadge({ tier, p }) {
  const t = LABELS[tier] || LABELS.unknown
  const pct = typeof p === 'number' ? ` · ${Math.round(p * 100)}%` : ''
  return <span className={`badge ${t.cls}`}>{t.text}{pct}</span>
}
