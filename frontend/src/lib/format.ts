/** Display helpers. Amounts come from the backend as whole cents. */

const rand = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' })

export function money(minor: number): string {
  return rand.format(minor / 100)
}

/** "+R 1 250,00" for money in, "−R 45,00" for money out. */
export function signedMoney(minor: number, direction: 'inflow' | 'outflow'): string {
  return `${direction === 'inflow' ? '+' : '−'}${money(minor)}`
}

/** "R 1 234.56" style text → cents. Returns null if it isn't a valid positive amount. */
export function parseRandInput(text: string): number | null {
  const cleaned = text.replace(/[R\s ]/gi, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [whole, fraction = ''] = cleaned.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatPeriod(start: string, end: string): string {
  return `${formatDate(start)} – ${formatDate(end)}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
