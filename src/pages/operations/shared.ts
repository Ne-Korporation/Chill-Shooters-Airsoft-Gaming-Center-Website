import { modelOf } from '../../utils/inventoryModels'

export const LOCATIONS = [
  { id: 'salawag', name: 'Chill Shooters (Salawag)' },
  { id: 'langkaan', name: 'Chill Shooters (Langkaan)' },
  { id: 'binan', name: 'BBC Airsoft Binan Laguna' },
] as const

export const SLOTS = ['morning', 'afternoon', 'evening'] as const

export const selectClass =
  'w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background'

export function manilaTodayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

export function formatPHP(value: number) {
  const amount = Number(value || 0)
  const text = `₱${Math.abs(amount).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
  return amount < 0 ? `−${text}` : text
}

export function formatDateTime(iso?: string) {
  if (!iso) return '-'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export type InventoryOption = {
  id: string
  name: string
  category: string
  collection: 'weapons' | 'equipments'
  // One record per physical piece: "M4 Rifle #3" is piece 3 of the "M4 Rifle" model.
  model: string
  unitNumber: number
  status: string
}

export function toInventoryOptions(docs: any[], collection: 'weapons' | 'equipments'): InventoryOption[] {
  return docs
    // Player-owned gear is not center inventory.
    .filter((doc) => doc.source !== 'player')
    .map((doc) => ({
      id: String(doc.id || doc._id || ''),
      name: String(doc.name || 'Unnamed'),
      category: String(doc.category || (collection === 'weapons' ? 'rifles' : 'gear')).toLowerCase(),
      collection,
      model: modelOf(doc),
      unitNumber: Number(doc.unitNumber) || 0,
      status: String(doc.status || 'available').toLowerCase(),
    }))
    .filter((item) => item.id)
}

// "consumables" -> "Consumables"
export function categoryLabel(category: string) {
  const text = String(category || 'other').replace(/[-_]+/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
