import { useState } from 'react'
import { money, monthLabel } from '../lib/format'
import './TrendChart.css'

export type TrendPoint = { month: string; value: number; coverage: 'full' | 'partial' | 'none' }

/**
 * Money out per month as columns (one series, one colour).
 * Partial months are lighter AND labelled "partial" so it's never colour alone;
 * each column shows its value on hover/focus; a hidden table carries the numbers.
 */
export function TrendChart({
  title,
  points,
  selected,
  onSelect,
}: {
  title: string
  points: TrendPoint[]
  selected?: string
  onSelect?: (month: string) => void
}) {
  const [active, setActive] = useState<string | null>(null)
  const max = Math.max(...points.map((p) => p.value), 1)
  const hasData = points.some((p) => p.coverage !== 'none')
  const short = (m: string) => monthLabel(m).split(' ')[0]!.slice(0, 3)

  if (!hasData) return <p className="muted">Import a few months of statements to see a trend.</p>

  return (
    <figure className="trend">
      <figcaption className="visually-hidden">{title}</figcaption>
      <div className="trend__plot">
        <div className="trend__axis" aria-hidden>
          <span>{money(max).replace(/[.,]00$/, '')}</span>
          <span>R 0</span>
        </div>
        <div className="trend__columns">
          {points.map((p) => {
            const height = p.coverage === 'none' ? 0 : Math.max((p.value / max) * 100, p.value > 0 ? 2 : 0)
            const isSelected = p.month === selected
            const showTip = active === p.month
            const label = `${monthLabel(p.month)}: ${p.coverage === 'none' ? 'no statements' : money(p.value)}${p.coverage === 'partial' ? ' (partial month)' : ''}`
            return (
              <button
                key={p.month}
                type="button"
                className={`trend__slot${isSelected ? ' trend__slot--selected' : ''}`}
                aria-label={label}
                aria-pressed={isSelected}
                onMouseEnter={() => setActive(p.month)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(p.month)}
                onBlur={() => setActive(null)}
                onClick={() => onSelect?.(p.month)}
              >
                <span className="trend__track">
                  {isSelected && p.coverage !== 'none' && (
                    <span className="trend__value" style={{ bottom: `${height}%` }}>
                      {money(p.value).replace(/[.,]\d\d$/, '')}
                    </span>
                  )}
                  <span className={`trend__bar trend__bar--${p.coverage}`} style={{ height: `${height}%` }} />
                </span>
                <span className="trend__label">
                  {short(p.month)}
                  {p.coverage === 'partial' && <small>part</small>}
                  {p.coverage === 'none' && <small>—</small>}
                </span>
                {showTip && (
                  <span className="trend__tooltip" role="tooltip">
                    <strong>{monthLabel(p.month)}</strong>
                    <span>{p.coverage === 'none' ? 'No statements imported' : money(p.value)}</span>
                    {p.coverage === 'partial' && <span className="muted">Partial month — may be incomplete</span>}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Money out</th>
            <th>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <td>{monthLabel(p.month)}</td>
              <td>{p.coverage === 'none' ? '—' : money(p.value)}</td>
              <td>{p.coverage === 'full' ? 'Whole month' : p.coverage === 'partial' ? 'Partial month' : 'No statements'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
