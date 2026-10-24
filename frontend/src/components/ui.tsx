import type { ReactNode } from 'react'
import { monthLabel, shiftMonth } from '../lib/format'

/** Title row used at the top of every page. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="page-header__eyebrow">{eyebrow}</p>}
        <h1 className="page-header__title">{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}

/** A row of stat tiles inside a card. */
export function Stats({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="card stats" aria-label={label}>
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'positive' | 'negative' | 'warn'
}) {
  return (
    <div className={`stat${tone === 'warn' ? ' stat--warn' : ''}`}>
      <span className="stat__label">{label}</span>
      <strong className={`stat__value${tone === 'positive' || tone === 'negative' ? ` ${tone}` : ''}`}>{value}</strong>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  )
}

/** Previous / month / next. `max` stops you going into the future. */
export function MonthPicker({ month, onChange, max }: { month: string; onChange: (m: string) => void; max?: string }) {
  const atMax = max !== undefined && month >= max
  return (
    <div className="month-picker" role="group" aria-label="Choose month">
      <button type="button" className="icon-button" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        ‹
      </button>
      <span className="month-picker__label" aria-live="polite">
        {monthLabel(month)}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label="Next month"
        disabled={atMax}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        ›
      </button>
    </div>
  )
}

/** Single-choice filter buttons. */
export function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="filter-chip" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="card empty-state">
      <h2 className="section-title">{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action}
    </section>
  )
}

/** Thin bar showing a share (0–1) of a total. */
export function ShareBar({ share, label }: { share: number; label: string }) {
  const pct = Math.max(0, Math.min(1, share)) * 100
  return (
    <div className="bar" role="img" aria-label={label}>
      <div className="bar__fill" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** A labelled dropdown used for every list filter. */
export function FilterSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <label className="filter-select">
      <span className="filter-select__label">{label}</span>
      <select className="filter-select__input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
