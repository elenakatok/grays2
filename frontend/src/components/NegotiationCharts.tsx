// ═══════════════════════════════════════════════════════════════════════════════
// GRAYS 2.0 — negotiation report charts (grays.com report parity).
//
// A faithful reproduction of the grays.com Reports charts, adapted to grays 2.0's
// data shapes (role keys 'chris'/'kelly', reservations from config). Three SVG charts,
// each projector-friendly at 1280×680:
//   • PriceHistogramSVG   — binned distribution of agreed final prices + ZOPA lines + stats
//   • ScatterPlotSVG      — final price vs. group initial offer, with a fitted OLS line
//   • DualPrepHistSVG     — side-by-side Seller/Buyer histograms of a prep NUMBER field
//
// Pure presentational: they take already-fetched report data and render. No fetching,
// no state. grays.com is read-only reference — this is an independent reproduction, not
// an import.
// ═══════════════════════════════════════════════════════════════════════════════

import type { RefObject } from 'react'

// ── Shared data shapes (mirror getReportData's server types) ───────────────────

export type ReportGroup = {
  group_id: string
  status: string
  agreement_reached: boolean | null
  final_price: number | null
  group_initial_price: number | null
  chris_participants: string[]
  kelly_participants: string[]
}

export type ReportParticipant = {
  participant_id: string
  display_name: string
  role: 'chris' | 'kelly'
  prep_planned_first_offer: number | null
  prep_estimated_other_price: number | null
  debrief_reflection: string | null
}

export type ChartConfig = {
  reservation_price_chris: number
  reservation_price_kelly: number
}

type PrepNumberField = 'prep_planned_first_offer' | 'prep_estimated_other_price'

// ── Formatting ────────────────────────────────────────────────────────────────

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function usdShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n}`
}

function niceTicks(min: number, max: number, count = 6): number[] {
  const range = max - min || 1
  const raw = range / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = norm < 1.5 ? mag : norm < 3.5 ? 2 * mag : norm < 7.5 ? 5 * mag : 10 * mag
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let t = start; t <= max + step * 0.01; t += step) ticks.push(Math.round(t))
  return ticks
}

const BIN_WIDTHS = [25_000, 50_000, 100_000, 250_000, 500_000]

// ═══ Price histogram ═══════════════════════════════════════════════════════════

interface HistData {
  deals: number; noDeals: number
  axisMin: number; axisMax: number; span: number
  binWidth: number; numBins: number; bins: number[]
  minPrice: number | null; maxPrice: number | null; mean: number | null; stdDev: number | null
}

function computeHistogram(groups: ReportGroup[], config: ChartConfig): HistData {
  const dealPrices = groups
    .filter(g => g.status === 'completed' && g.agreement_reached === true && g.final_price != null)
    .map(g => g.final_price!)
  const noDeals = groups.filter(g => g.status === 'completed' && g.agreement_reached === false).length
  const deals = dealPrices.length

  const axisMin = deals > 0
    ? Math.min(config.reservation_price_chris, Math.min(...dealPrices))
    : config.reservation_price_chris
  const axisMax = deals > 0
    ? Math.max(config.reservation_price_kelly, Math.max(...dealPrices))
    : config.reservation_price_kelly
  const span = Math.max(axisMax - axisMin, 1)

  const binWidth = BIN_WIDTHS.find(w => Math.ceil(span / w) <= 20) ?? 500_000
  const numBins = Math.max(1, Math.ceil(span / binWidth))

  const bins: number[] = Array(numBins).fill(0)
  dealPrices.forEach(p => {
    const i = Math.min(Math.floor((p - axisMin) / binWidth), numBins - 1)
    bins[i]++
  })

  let minPrice: number | null = null, maxPrice: number | null = null
  let mean: number | null = null, stdDev: number | null = null
  if (deals > 0) {
    minPrice = Math.min(...dealPrices)
    maxPrice = Math.max(...dealPrices)
    mean = dealPrices.reduce((a, b) => a + b, 0) / deals
    const variance = dealPrices.reduce((a, b) => a + (b - mean!) ** 2, 0) / deals
    stdDev = Math.sqrt(variance)
  }
  return { deals, noDeals, axisMin, axisMax, span, binWidth, numBins, bins, minPrice, maxPrice, mean, stdDev }
}

const W = 1280, H = 680
const M = { top: 88, right: 50, bottom: 158, left: 55 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom

export function PriceHistogramSVG({ groups, config, svgRef }: {
  groups: ReportGroup[]; config: ChartConfig; svgRef?: RefObject<SVGSVGElement | null>
}) {
  const h = computeHistogram(groups, config)
  const maxCount = Math.max(...h.bins, 1)
  const baseline = M.top + PH
  const xOf = (price: number) => M.left + ((price - h.axisMin) / h.span) * PW
  const barW = PW / h.numBins
  const chrisX = xOf(config.reservation_price_chris)
  const kellyX = xOf(config.reservation_price_kelly)
  const labelStep = Math.max(1, Math.round(h.numBins / 7))
  const statsY = baseline + 96

  const statItems = [
    { k: 'Deals', v: String(h.deals) },
    { k: 'No-deals', v: String(h.noDeals) },
    { k: 'Min', v: h.minPrice != null ? USD.format(h.minPrice) : '—' },
    { k: 'Max', v: h.maxPrice != null ? USD.format(h.maxPrice) : '—' },
    { k: 'Average', v: h.mean != null ? USD.format(Math.round(h.mean)) : '—' },
    { k: 'Std Dev', v: h.stdDev != null ? USD.format(Math.round(h.stdDev)) : '—' },
  ]

  return (
    <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect width={W} height={H} fill="#ffffff" />
      <text x={W / 2} y={26} textAnchor="middle" fontSize={22} fontWeight={700} fill="#111" fontFamily="sans-serif">
        Price Distribution — Final Agreed Prices
      </text>
      <rect x={M.left} y={M.top} width={PW} height={PH} fill="#f9fafb" stroke="#e5e7eb" />
      {[0.25, 0.5, 0.75, 1.0].map(frac => {
        const y = M.top + PH * (1 - frac)
        return (
          <g key={frac}>
            <line x1={M.left} y1={y} x2={M.left + PW} y2={y} stroke="#e5e7eb" strokeWidth={1} />
            <text x={M.left - 7} y={y + 5} textAnchor="end" fontSize={11} fill="#9ca3af" fontFamily="sans-serif">
              {Math.round(frac * maxCount)}
            </text>
          </g>
        )
      })}
      {h.bins.map((count, i) => {
        if (count === 0) return null
        const x = M.left + i * barW
        const bh = (count / maxCount) * PH
        const y = baseline - bh
        const fontSize = Math.min(20, Math.max(11, Math.round(barW * 0.32)))
        return (
          <g key={i}>
            <rect x={x + 2} y={y} width={barW - 4} height={bh} fill="#2563eb" opacity={0.80} rx={3} />
            <text x={x + barW / 2} y={y - 7} textAnchor="middle" fontSize={fontSize} fontWeight={700} fill="#1d4ed8" fontFamily="sans-serif">
              {count}
            </text>
          </g>
        )
      })}
      <line x1={chrisX} y1={M.top} x2={chrisX} y2={baseline} stroke="#d97706" strokeWidth={2.5} strokeDasharray="8 5" />
      <text x={chrisX + 7} y={M.top + 18} fontSize={13} fontWeight={600} fill="#d97706" fontFamily="sans-serif">Seller&apos;s floor</text>
      <text x={chrisX + 7} y={M.top + 34} fontSize={12} fill="#d97706" fontFamily="sans-serif">{USD.format(config.reservation_price_chris)}</text>
      <line x1={kellyX} y1={M.top} x2={kellyX} y2={baseline} stroke="#7c3aed" strokeWidth={2.5} strokeDasharray="8 5" />
      <text x={kellyX - 7} y={M.top + 18} textAnchor="end" fontSize={13} fontWeight={600} fill="#7c3aed" fontFamily="sans-serif">Buyer&apos;s ceiling</text>
      <text x={kellyX - 7} y={M.top + 34} textAnchor="end" fontSize={12} fill="#7c3aed" fontFamily="sans-serif">{USD.format(config.reservation_price_kelly)}</text>
      <line x1={M.left} y1={baseline} x2={M.left + PW} y2={baseline} stroke="#374151" strokeWidth={2} />
      {Array.from({ length: h.numBins + 1 }, (_, i) => {
        if (i % labelStep !== 0 && i !== h.numBins) return null
        const price = h.axisMin + i * h.binWidth
        const x = M.left + i * barW
        return (
          <text key={i} x={x} y={baseline + 15} textAnchor="end" fontSize={12} fill="#6b7280" fontFamily="sans-serif" transform={`rotate(-40 ${x} ${baseline + 15})`}>
            {usdShort(price)}
          </text>
        )
      })}
      <line x1={M.left} y1={statsY - 18} x2={M.left + PW} y2={statsY - 18} stroke="#e5e7eb" strokeWidth={1} />
      {statItems.map((s, i) => {
        const cx = M.left + (i + 0.5) * (PW / statItems.length)
        return (
          <g key={i}>
            <text x={cx} y={statsY} textAnchor="middle" fontSize={21} fontWeight={700} fill="#111" fontFamily="sans-serif">{s.v}</text>
            <text x={cx} y={statsY + 22} textAnchor="middle" fontSize={13} fill="#6b7280" fontFamily="sans-serif">{s.k}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ═══ Regression scatter — final price vs. initial offer ════════════════════════

interface RegData {
  points: { x: number; y: number }[]
  n: number; canFit: boolean
  a: number | null; b: number | null; r2: number | null
  axisMinX: number; axisMaxX: number; axisMinY: number; axisMaxY: number
}

function computeRegression(groups: ReportGroup[]): RegData {
  const points = groups
    .filter(g => g.status === 'completed' && g.agreement_reached === true && g.final_price != null && g.group_initial_price != null)
    .map(g => ({ x: g.group_initial_price!, y: g.final_price! }))
  const n = points.length

  if (n === 0) {
    return { points, n, canFit: false, a: null, b: null, r2: null, axisMinX: 0, axisMaxX: 500_000, axisMinY: 0, axisMaxY: 500_000 }
  }
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  const pad = (arr: number[]) => {
    const lo = Math.min(...arr), hi = Math.max(...arr)
    const p = Math.max((hi - lo) * 0.12, 25_000)
    return { lo: Math.max(0, lo - p), hi: hi + p }
  }
  const rx = pad(xs), ry = pad(ys)
  const xBar = xs.reduce((s, v) => s + v, 0) / n
  const yBar = ys.reduce((s, v) => s + v, 0) / n
  const ssX = xs.reduce((s, v) => s + (v - xBar) ** 2, 0)

  if (n < 3 || ssX < 1) {
    return { points, n, canFit: false, a: null, b: null, r2: null, axisMinX: rx.lo, axisMaxX: rx.hi, axisMinY: ry.lo, axisMaxY: ry.hi }
  }
  const ssXY = points.reduce((s, p) => s + (p.x - xBar) * (p.y - yBar), 0)
  const ssY = ys.reduce((s, v) => s + (v - yBar) ** 2, 0)
  const b = ssXY / ssX
  const a = yBar - b * xBar
  const r2 = ssY > 0 ? (ssXY ** 2) / (ssX * ssY) : 0
  return { points, n, canFit: true, a, b, r2, axisMinX: rx.lo, axisMaxX: rx.hi, axisMinY: ry.lo, axisMaxY: ry.hi }
}

const SW = 1280, SH = 680
const SM = { top: 68, right: 70, bottom: 150, left: 116 }
const SPW = SW - SM.left - SM.right
const SPH = SH - SM.top - SM.bottom

export function ScatterPlotSVG({ groups, svgRef }: { groups: ReportGroup[]; svgRef?: RefObject<SVGSVGElement | null> }) {
  const r = computeRegression(groups)
  const spanX = r.axisMaxX - r.axisMinX || 1
  const spanY = r.axisMaxY - r.axisMinY || 1
  const xPx = (v: number) => SM.left + ((v - r.axisMinX) / spanX) * SPW
  const yPx = (v: number) => SM.top + SPH - ((v - r.axisMinY) / spanY) * SPH
  const xTicks = niceTicks(r.axisMinX, r.axisMaxX, 7)
  const yTicks = niceTicks(r.axisMinY, r.axisMaxY, 6)
  const lineX0 = SM.left, lineX1 = SM.left + SPW
  const lineY0 = r.canFit && r.a != null && r.b != null ? yPx(r.a + r.b * r.axisMinX) : 0
  const lineY1 = r.canFit && r.a != null && r.b != null ? yPx(r.a + r.b * r.axisMaxX) : 0
  const statsY = SM.top + SPH + 60
  const sepY = statsY - 18

  const statItems = r.canFit
    ? [
        { k: 'N (groups)', v: String(r.n) },
        { k: 'Slope (b)', v: r.b != null ? r.b.toFixed(3) : '—' },
        { k: 'Intercept (a)', v: r.a != null ? USD.format(Math.round(r.a)) : '—' },
        { k: 'R²', v: r.r2 != null ? r.r2.toFixed(3) : '—' },
      ]
    : [{ k: 'N (groups)', v: String(r.n) }]

  const equation = r.canFit && r.a != null && r.b != null
    ? `Final Price = ${USD.format(Math.round(r.a))} ${r.b >= 0 ? '+' : '−'} ${Math.abs(r.b).toFixed(3)} · Initial Offer`
    : null

  return (
    <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${SW} ${SH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect width={SW} height={SH} fill="#ffffff" />
      <text x={SW / 2} y={26} textAnchor="middle" fontSize={22} fontWeight={700} fill="#111" fontFamily="sans-serif">
        Regression: Final Agreed Price vs. Initial Offer
      </text>
      <text x={SW / 2} y={48} textAnchor="middle" fontSize={13} fill="#6b7280" fontFamily="sans-serif">
        x = opening offer (debrief)  ·  y = final agreed price  ·  deals only
      </text>
      <defs><clipPath id="scatter-clip"><rect x={SM.left} y={SM.top} width={SPW} height={SPH} /></clipPath></defs>
      <rect x={SM.left} y={SM.top} width={SPW} height={SPH} fill="#f9fafb" stroke="#e5e7eb" />
      {yTicks.map(t => {
        const y = yPx(t)
        if (y < SM.top - 1 || y > SM.top + SPH + 1) return null
        return (
          <g key={t}>
            <line x1={SM.left} y1={y} x2={SM.left + SPW} y2={y} stroke="#e5e7eb" strokeWidth={1} />
            <text x={SM.left - 8} y={y + 4} textAnchor="end" fontSize={12} fill="#9ca3af" fontFamily="sans-serif">{usdShort(t)}</text>
          </g>
        )
      })}
      {xTicks.map(t => {
        const x = xPx(t)
        if (x < SM.left - 1 || x > SM.left + SPW + 1) return null
        return (
          <g key={t}>
            <line x1={x} y1={SM.top} x2={x} y2={SM.top + SPH} stroke="#e5e7eb" strokeWidth={1} />
            <text x={x} y={SM.top + SPH + 18} textAnchor="middle" fontSize={12} fill="#6b7280" fontFamily="sans-serif">{usdShort(t)}</text>
          </g>
        )
      })}
      <line x1={SM.left} y1={SM.top} x2={SM.left} y2={SM.top + SPH} stroke="#374151" strokeWidth={2} />
      <line x1={SM.left} y1={SM.top + SPH} x2={SM.left + SPW} y2={SM.top + SPH} stroke="#374151" strokeWidth={2} />
      <text x={SM.left - 82} y={SM.top + SPH / 2} transform={`rotate(-90, ${SM.left - 82}, ${SM.top + SPH / 2})`} textAnchor="middle" fontSize={14} fill="#374151" fontFamily="sans-serif">
        Final agreed price ($)
      </text>
      <text x={SM.left + SPW / 2} y={SM.top + SPH + 40} textAnchor="middle" fontSize={14} fill="#374151" fontFamily="sans-serif">Initial offer ($)</text>
      {r.canFit && (
        <line x1={lineX0} y1={lineY0} x2={lineX1} y2={lineY1} stroke="#dc2626" strokeWidth={2.5} opacity={0.75} clipPath="url(#scatter-clip)" />
      )}
      {r.points.map((p, i) => (
        <circle key={i} cx={xPx(p.x)} cy={yPx(p.y)} r={9} fill="#2563eb" opacity={0.78} clipPath="url(#scatter-clip)" />
      ))}
      {!r.canFit && r.n > 0 && (
        <text x={SM.left + SPW / 2} y={SM.top + SPH / 2 + 6} textAnchor="middle" fontSize={15} fill="#94a3b8" fontFamily="sans-serif">
          Not enough variation to fit a regression line.
        </text>
      )}
      {r.n === 0 && (
        <text x={SM.left + SPW / 2} y={SM.top + SPH / 2 + 6} textAnchor="middle" fontSize={15} fill="#94a3b8" fontFamily="sans-serif">
          No data — deals need both a final price and a numeric opening offer (debrief).
        </text>
      )}
      <line x1={SM.left} y1={sepY} x2={SM.left + SPW} y2={sepY} stroke="#e5e7eb" strokeWidth={1} />
      {statItems.map((s, i) => {
        const cx = SM.left + (i + 0.5) * (SPW / statItems.length)
        return (
          <g key={i}>
            <text x={cx} y={statsY} textAnchor="middle" fontSize={21} fontWeight={700} fill="#111" fontFamily="sans-serif">{s.v}</text>
            <text x={cx} y={statsY + 22} textAnchor="middle" fontSize={13} fill="#6b7280" fontFamily="sans-serif">{s.k}</text>
          </g>
        )
      })}
      {equation && (
        <text x={SM.left + SPW / 2} y={statsY + 52} textAnchor="middle" fontSize={15} fontStyle="italic" fill="#374151" fontFamily="sans-serif">{equation}</text>
      )}
      {!r.canFit && r.n > 0 && r.n < 3 && (
        <text x={SM.left + SPW / 2} y={statsY + 52} textAnchor="middle" fontSize={13} fill="#94a3b8" fontFamily="sans-serif">
          Need at least 3 groups with both a deal and a numeric opening offer to fit a line.
        </text>
      )}
    </svg>
  )
}

// ═══ Dual-panel prep histogram (Seller | Buyer) ════════════════════════════════

const DW = 1280, DH = 680
const D_TH = 66
const D_PPH = 429
const D_BL = D_TH + D_PPH
const D_IML = 33
const D_PPW = 533
const D_LP_PX = 20 + D_IML
const D_RP_PX = D_LP_PX + D_PPW + 108 + D_IML
const D_STATS_Y = D_BL + 78

interface PrepPanelData { n: number; min: number | null; max: number | null; mean: number | null; stdDev: number | null; bins: number[] }
interface DualPrepData { chris: PrepPanelData; kelly: PrepPanelData; axisMin: number; axisMax: number; span: number; binWidth: number; numBins: number }

function computeDualPrep(participants: ReportParticipant[], config: ChartConfig, field: PrepNumberField): DualPrepData {
  const chrisVals = participants.filter(p => p.role === 'chris' && p[field] != null).map(p => p[field]!)
  const kellyVals = participants.filter(p => p.role === 'kelly' && p[field] != null).map(p => p[field]!)
  const all = [...chrisVals, ...kellyVals]
  const zopaMin = config.reservation_price_chris
  const zopaMax = config.reservation_price_kelly
  const axisMin = all.length > 0 ? Math.min(zopaMin, ...all) : zopaMin
  const axisMax = all.length > 0 ? Math.max(zopaMax, ...all) : zopaMax
  const span = Math.max(axisMax - axisMin, 1)
  const binWidth = BIN_WIDTHS.find(w => Math.ceil(span / w) <= 20) ?? 500_000
  const numBins = Math.max(1, Math.ceil(span / binWidth))

  function panel(vals: number[]): PrepPanelData {
    const n = vals.length
    const bins = Array<number>(numBins).fill(0)
    vals.forEach(v => { const i = Math.min(Math.floor((v - axisMin) / binWidth), numBins - 1); bins[i]++ })
    if (n === 0) return { n, min: null, max: null, mean: null, stdDev: null, bins }
    const min = Math.min(...vals), max = Math.max(...vals)
    const mean = vals.reduce((a, b) => a + b, 0) / n
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n
    return { n, min, max, mean, stdDev: Math.sqrt(variance), bins }
  }
  return { chris: panel(chrisVals), kelly: panel(kellyVals), axisMin, axisMax, span, binWidth, numBins }
}

export function DualPrepHistSVG({ participants, config, field, title, svgRef }: {
  participants: ReportParticipant[]; config: ChartConfig; field: PrepNumberField; title: string; svgRef?: RefObject<SVGSVGElement | null>
}) {
  const d = computeDualPrep(participants, config, field)
  const maxCountC = Math.max(...d.chris.bins, 1)
  const maxCountK = Math.max(...d.kelly.bins, 1)
  const xPxLeft = (v: number) => D_LP_PX + ((v - d.axisMin) / d.span) * D_PPW
  const xPxRight = (v: number) => D_RP_PX + ((v - d.axisMin) / d.span) * D_PPW
  const barW = D_PPW / d.numBins
  const labelStep = Math.max(1, Math.round(d.numBins / 7))
  const chrisFloorX = (plotX: (v: number) => number) => plotX(config.reservation_price_chris)
  const kellyCeilX = (plotX: (v: number) => number) => plotX(config.reservation_price_kelly)
  const statsFmt = (v: number | null) => v != null ? USD.format(Math.round(v)) : '—'

  function Panel({ plotX, maxCount, panel, roleLabel, roleColor, chrisX, kellyX }: {
    plotX: (v: number) => number; maxCount: number; panel: PrepPanelData; roleLabel: string; roleColor: string; chrisX: number; kellyX: number
  }) {
    const plotLeft = plotX(d.axisMin)
    return (
      <g>
        <text x={plotLeft + D_PPW / 2} y={D_TH - 10} textAnchor="middle" fontSize={17} fontWeight={700} fill={roleColor} fontFamily="sans-serif">{roleLabel}</text>
        <rect x={plotLeft} y={D_TH} width={D_PPW} height={D_PPH} fill="#f9fafb" stroke="#e5e7eb" />
        {[0.25, 0.5, 0.75, 1.0].map(frac => {
          const y = D_TH + D_PPH * (1 - frac)
          return (
            <g key={frac}>
              <line x1={plotLeft} y1={y} x2={plotLeft + D_PPW} y2={y} stroke="#e5e7eb" strokeWidth={1} />
              <text x={plotLeft - 6} y={y + 4} textAnchor="end" fontSize={11} fill="#9ca3af" fontFamily="sans-serif">{Math.round(frac * maxCount)}</text>
            </g>
          )
        })}
        {panel.bins.map((count, i) => {
          if (count === 0) return null
          const x = plotLeft + i * barW
          const bh = (count / maxCount) * D_PPH
          const y = D_BL - bh
          const fs = Math.min(18, Math.max(10, Math.round(barW * 0.30)))
          return (
            <g key={i}>
              <rect x={x + 2} y={y} width={barW - 4} height={bh} fill="#2563eb" opacity={0.80} rx={3} />
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={fs} fontWeight={700} fill="#1d4ed8" fontFamily="sans-serif">{count}</text>
            </g>
          )
        })}
        <line x1={chrisX} y1={D_TH} x2={chrisX} y2={D_BL} stroke="#d97706" strokeWidth={2.5} strokeDasharray="8 5" />
        <line x1={kellyX} y1={D_TH} x2={kellyX} y2={D_BL} stroke="#7c3aed" strokeWidth={2.5} strokeDasharray="8 5" />
        <line x1={plotLeft} y1={D_BL} x2={plotLeft + D_PPW} y2={D_BL} stroke="#374151" strokeWidth={2} />
        {Array.from({ length: d.numBins + 1 }, (_, i) => {
          if (i % labelStep !== 0 && i !== d.numBins) return null
          const price = d.axisMin + i * d.binWidth
          const x = plotLeft + i * barW
          return (
            <text key={i} x={x} y={D_BL + 15} textAnchor="end" fontSize={12} fill="#6b7280" fontFamily="sans-serif" transform={`rotate(-40 ${x} ${D_BL + 15})`}>{usdShort(price)}</text>
          )
        })}
        {panel.n === 0 && (
          <text x={plotLeft + D_PPW / 2} y={D_TH + D_PPH / 2 + 6} textAnchor="middle" fontSize={14} fill="#94a3b8" fontFamily="sans-serif">No data</text>
        )}
        {[
          { k: 'N', v: String(panel.n) },
          { k: 'Min', v: statsFmt(panel.min) },
          { k: 'Max', v: statsFmt(panel.max) },
          { k: 'Average', v: statsFmt(panel.mean) },
          { k: 'Std Dev', v: statsFmt(panel.stdDev) },
        ].map((s, i, arr) => {
          const cx = plotLeft + (i + 0.5) * (D_PPW / arr.length)
          return (
            <g key={i}>
              <text x={cx} y={D_STATS_Y} textAnchor="middle" fontSize={19} fontWeight={700} fill="#111" fontFamily="sans-serif">{s.v}</text>
              <text x={cx} y={D_STATS_Y + 22} textAnchor="middle" fontSize={12} fill="#6b7280" fontFamily="sans-serif">{s.k}</text>
            </g>
          )
        })}
      </g>
    )
  }

  const legendY = 52
  return (
    <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${DW} ${DH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect width={DW} height={DH} fill="#ffffff" />
      <text x={DW / 2} y={24} textAnchor="middle" fontSize={21} fontWeight={700} fill="#111" fontFamily="sans-serif">{title}</text>
      <g>
        <line x1={DW / 2 - 178} y1={legendY - 4} x2={DW / 2 - 150} y2={legendY - 4} stroke="#d97706" strokeWidth={2.5} strokeDasharray="6 4" />
        <text x={DW / 2 - 145} y={legendY} fontSize={12} fill="#d97706" fontFamily="sans-serif">{"Seller's floor"} ({USD.format(config.reservation_price_chris)})</text>
        <line x1={DW / 2 + 24} y1={legendY - 4} x2={DW / 2 + 52} y2={legendY - 4} stroke="#7c3aed" strokeWidth={2.5} strokeDasharray="6 4" />
        <text x={DW / 2 + 57} y={legendY} fontSize={12} fill="#7c3aed" fontFamily="sans-serif">{"Buyer's ceiling"} ({USD.format(config.reservation_price_kelly)})</text>
      </g>
      <line x1={D_LP_PX} y1={D_BL + 50} x2={D_LP_PX + D_PPW} y2={D_BL + 50} stroke="#e5e7eb" strokeWidth={1} />
      <line x1={D_RP_PX} y1={D_BL + 50} x2={D_RP_PX + D_PPW} y2={D_BL + 50} stroke="#e5e7eb" strokeWidth={1} />
      <Panel plotX={xPxLeft} maxCount={maxCountC} panel={d.chris} roleLabel="Seller (Chris)" roleColor="#0369a1" chrisX={chrisFloorX(xPxLeft)} kellyX={kellyCeilX(xPxLeft)} />
      <Panel plotX={xPxRight} maxCount={maxCountK} panel={d.kelly} roleLabel="Buyer (Kelly)" roleColor="#0f766e" chrisX={chrisFloorX(xPxRight)} kellyX={kellyCeilX(xPxRight)} />
    </svg>
  )
}
