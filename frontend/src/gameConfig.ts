import { type RoleConfig } from '@mygames/game-engine/roles'
import { type OutcomeField, type OutcomeSchema } from '@mygames/game-engine/outcome'

export type { RoleConfig, OutcomeField, OutcomeSchema }

// Chris = seller (lead), Kelly = buyer. Keys are stable; content is Part 2/3.
export const graysConfig: RoleConfig = {
  roles: [
    { key: 'chris', label: 'Chris', short: 'C' },
    { key: 'kelly', label: 'Kelly', short: 'K' },
  ],
}

// STUB outcome schema — mirrors functions/src/gameDefinition.ts. Part 3 replaces
// the single price field with the real contract fields.
export const graysSchema: OutcomeSchema = [
  { key: 'price', type: 'integer', min: 0, max: 1_000_000 },
  { key: 'notes', type: 'text' },  // optional free-text; blank = '', excluded from scoring
]

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  price: 'Price',
  notes: 'Notes',
}

export function formatField(field: OutcomeField, value: unknown): string {
  if (field.type === 'integer') {
    const n = value as number
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n)
  }
  if (field.type === 'enum')    return value as string
  if (field.type === 'boolean') return (value as boolean) ? 'Yes' : 'No'
  return String(value)
}
