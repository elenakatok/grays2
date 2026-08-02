import { type RoleConfig } from '@mygames/game-engine/roles'
import { type OutcomeField, type OutcomeSchema } from '@mygames/game-engine/outcome'

export type { RoleConfig, OutcomeField, OutcomeSchema }

// Chris = seller (lead), Kelly = buyer.
export const graysConfig: RoleConfig = {
  roles: [
    { key: 'chris', label: 'Chris', short: 'C' },
    { key: 'kelly', label: 'Kelly', short: 'K' },
  ],
}

// The negotiated outcome is a single agreed price (spec §2 Phase 2 Step 6). Mirrors
// functions/src/gameDefinition.ts.
export const graysSchema: OutcomeSchema = [
  { key: 'price', type: 'integer', min: 0, max: 10_000_000 },
]

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  price: 'Agreed price',
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
