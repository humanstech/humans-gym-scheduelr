const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })

export function formatEUR(cents: number): string {
  return eur.format(cents / 100)
}

/** Parses "12,50" / "12.5" / "12" into cents; returns null when invalid. */
export function parseEURToCents(value: string): number | null {
  const normalized = value.trim().replace(/\s|€/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 100)
}
