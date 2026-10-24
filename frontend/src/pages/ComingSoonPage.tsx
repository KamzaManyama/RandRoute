type Props = { title: string; description: string }

/** Temporary page for screens that are not built yet. */
export function ComingSoonPage({ title, description }: Props) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <h1 style={{ fontSize: '1.6rem' }}>{title}</h1>
      <section className="card">
        <p className="muted">{description}</p>
      </section>
    </div>
  )
}
