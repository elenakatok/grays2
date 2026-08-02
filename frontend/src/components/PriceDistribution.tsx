// Tier-3 (spec §4.5 / §5 Results): the distribution of final prices across groups, for
// debrief. Hand-rolled SVG (house style, no charting library). Each deal is a dot on a
// price axis spanning the ZOPA; the two reservation prices are marked; deals landing near
// a reservation are flagged (an unusually one-sided outcome), and walk-aways are called
// out separately since they have no price.

export interface PriceDeal { groupNumber: number; price: number }

export interface PriceDistributionProps {
  deals: readonly PriceDeal[]          // one per group that reached agreement
  walkaways: readonly number[]         // group numbers with no deal
  reservationChris: number             // seller floor (ZOPA min)
  reservationKelly: number             // buyer ceiling (ZOPA max)
  svgRef?: React.Ref<SVGSVGElement>
}

const W = 860, H = 300
const M = { top: 40, left: 60, right: 40, bottom: 64 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom

const fmt = (n: number) => n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`
const fmtFull = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

export function PriceDistribution({ deals, walkaways, reservationChris, reservationKelly, svgRef }: PriceDistributionProps) {
  // Axis domain: the ZOPA, padded so points at the reservations aren't on the edge, and
  // widened if any deal fell outside the ZOPA (a mis-report or an unusual settlement).
  const prices = deals.map(d => d.price)
  const lo = Math.min(reservationChris, ...(prices.length ? prices : [reservationChris]))
  const hi = Math.max(reservationKelly, ...(prices.length ? prices : [reservationKelly]))
  const span = (hi - lo) || 1
  const pad = span * 0.08
  const dMin = lo - pad, dMax = hi + pad
  const x = (p: number) => M.left + ((p - dMin) / (dMax - dMin)) * PW

  // "Near a reservation" = within 10% of the ZOPA width of either floor/ceiling.
  const zopa = Math.max(1, reservationKelly - reservationChris)
  const nearRes = (p: number) => (p - reservationChris) <= 0.1 * zopa || (reservationKelly - p) <= 0.1 * zopa

  // Vertical jitter so overlapping prices stay distinguishable (dot-strip plot).
  const rowOf = (i: number) => (i % 5)
  const baseY = M.top + PH * 0.62
  const dy = 18

  const ticks = [reservationChris, (reservationChris + reservationKelly) / 2, reservationKelly]
    .concat(prices.length ? [Math.min(...prices), Math.max(...prices)] : [])

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ fontFamily: 'system-ui, sans-serif', background: '#fff' }}>
      {/* axis line */}
      <line x1={M.left} y1={baseY + 3 * dy} x2={W - M.right} y2={baseY + 3 * dy} stroke="#cbd5e1" strokeWidth={1} />

      {/* reservation markers */}
      {[{ p: reservationChris, label: `Chris floor ${fmt(reservationChris)}`, c: '#2563eb' },
        { p: reservationKelly, label: `Kelly ceiling ${fmt(reservationKelly)}`, c: '#dc2626' }].map(r => (
        <g key={r.label}>
          <line x1={x(r.p)} y1={M.top} x2={x(r.p)} y2={baseY + 3 * dy} stroke={r.c} strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={x(r.p)} y={M.top - 12} textAnchor="middle" fontSize={12} fill={r.c} fontWeight={600}>{r.label}</text>
        </g>
      ))}

      {/* x ticks */}
      {[...new Set(ticks)].map(t => (
        <text key={t} x={x(t)} y={baseY + 3 * dy + 20} textAnchor="middle" fontSize={11} fill="#64748b">{fmt(t)}</text>
      ))}

      {/* deals as dots */}
      {deals.slice().sort((a, b) => a.price - b.price).map((d, i) => {
        const cx = x(d.price), cy = baseY - rowOf(i) * dy
        const flagged = nearRes(d.price)
        return (
          <g key={d.groupNumber}>
            <circle cx={cx} cy={cy} r={6} fill={flagged ? '#f59e0b' : '#0f766e'} stroke="#fff" strokeWidth={1.5}>
              <title>{`Group ${d.groupNumber}: ${fmtFull(d.price)}${flagged ? ' (near a reservation price)' : ''}`}</title>
            </circle>
            <text x={cx} y={cy - 9} textAnchor="middle" fontSize={9} fill="#475569">G{d.groupNumber}</text>
          </g>
        )
      })}

      {/* legend + walk-aways */}
      <g transform={`translate(${M.left}, ${H - 14})`} fontSize={11} fill="#475569">
        <circle cx={5} cy={-4} r={5} fill="#0f766e" /><text x={16} y={0}>deal</text>
        <circle cx={62} cy={-4} r={5} fill="#f59e0b" /><text x={73} y={0}>near a reservation</text>
        <text x={210} y={0} fill="#92400e">
          {walkaways.length > 0 ? `Walk-aways (no deal): ${walkaways.length} — ${walkaways.map(n => 'G' + n).join(', ')}` : 'No walk-aways'}
        </text>
      </g>
    </svg>
  )
}
