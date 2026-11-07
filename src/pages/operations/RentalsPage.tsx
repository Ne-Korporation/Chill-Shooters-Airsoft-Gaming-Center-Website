import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiAlertTriangle, FiCheck, FiLogOut, FiX } from 'react-icons/fi'

import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { apiGet, apiGetAll, apiPost, apiPut } from '../../utils/apiClient'
import { Paged } from '../../components/ui/Pagination'
import { ItemCombobox, type ComboItem } from '../../components/ui/ItemCombobox'
import { categoryLabel, formatDateTime, selectClass, toInventoryOptions, type InventoryOption } from './shared'
import { useAuth } from '../../context/AuthContext'

// Guns and gear are the marshals' job: they hand them out and check them in. Everyone else
// (registrars) sees who has what, read-only.
const useCanHandleGear = () => {
  const { user } = useAuth()
  return user?.role === 'admin' || user?.role === 'marshal'
}

type Rental = {
  id: string
  reservationId: string
  reservationDate: string
  playerName: string
  playerId?: string
  itemCollection: 'weapons' | 'equipments'
  itemName: string
  unitLabel: string
  status: 'out' | 'returned' | 'missing'
  condition?: 'ok' | 'damaged' | 'missing'
  damageReportId?: string
  issuedAtISO: string
  returnedAtISO?: string
  overdue?: boolean
}

type TeamMember = { id: string; name: string }
type Slot = 'gun' | 'vest' | 'mask'
const SLOTS: Array<{ slot: Slot; label: string; placeholder: string }> = [
  { slot: 'gun', label: 'Gun', placeholder: 'Type to search, e.g. M4 #3, pistol' },
  { slot: 'vest', label: 'Vest', placeholder: 'Type a vest number' },
  { slot: 'mask', label: 'Mask', placeholder: 'Type a mask number' },
]
// Weapon categories that aren't a player's gun (thrown or consumable).
const NOT_GUNS = ['grenades']
// A gun or piece of gear a player brings from home (registered on their account).
type OwnItem = { playerId: string; collection: 'weapons' | 'equipments'; id: string; name: string; category: string }
// Which slot an own item fills: any own weapon is their gun; vests and masks by category.
const slotOfOwn = (item: OwnItem): Slot | null =>
  item.collection === 'weapons' ? (NOT_GUNS.includes(item.category) ? null : 'gun')
    : item.category.includes('vest') ? 'vest' : item.category.includes('mask') ? 'mask' : null
// A weapon tied to the booking: held for it at booking time, issued at the counter, or a player's own.
type BookingWeapon = { id: string; name: string; unitNumber: number; source: 'rental' | 'own'; rentedTo: string; rentalStatus: string }
type Condition = 'ok' | 'damaged' | 'missing'

// Rental check-out lives on the Games page: RentalsPanel in a game's pop-up (which player has
// which unit), StillOutPanel as its own tab. Damaged or missing items open a damage report
// (billed by the admin) and leave the rental pool.

async function checkInRental(rental: Rental, condition: Condition) {
  let note = ''
  if (condition !== 'ok') {
    note = window.prompt(condition === 'damaged' ? 'What is damaged?' : 'Any details about the missing item?') ?? ''
    if (condition === 'damaged' && !note.trim()) return false
  }
  try {
    const res = await apiPut<{ damageReport?: { id: string } }>(`/api/rentals/${encodeURIComponent(rental.id)}/return`, { condition, note })
    toast.success(res.damageReport ? `Checked in. Damage report ${res.damageReport.id} opened for billing.` : 'Checked in.')
    return true
  } catch (e: any) {
    toast.error(e?.message || 'Could not check in the item')
    return false
  }
}

function RentalRow({ rental, showReservation, hidePlayer, readOnly, onCheckIn }: { rental: Rental; showReservation?: boolean; hidePlayer?: boolean; readOnly?: boolean; onCheckIn: (rental: Rental, condition: Condition) => void }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-semibold">
          {rental.itemName}{rental.unitLabel ? ` · ${rental.unitLabel}` : ''}{hidePlayer ? '' : ` → ${rental.playerName}`}
        </div>
        <div className="text-[11px] text-muted">
          {showReservation ? `${rental.reservationId} · ${rental.reservationDate} · ` : ''}
          Out {formatDateTime(rental.issuedAtISO)}
          {rental.returnedAtISO ? ` · In ${formatDateTime(rental.returnedAtISO)}` : ''}
          {rental.damageReportId ? ` · ${rental.damageReportId}` : ''}
          {rental.overdue ? ' · not returned after game day' : ''}
        </div>
      </div>
      {rental.status === 'out' && readOnly ? (
        <span className="rounded-full border border-warning/30 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning">Out</span>
      ) : rental.status === 'out' ? (
        <div className="flex flex-none gap-1">
          <Button size="sm" variant="ghost" onClick={() => onCheckIn(rental, 'ok')}><FiCheck /> Returned OK</Button>
          <Button size="sm" variant="ghost" onClick={() => onCheckIn(rental, 'damaged')}>Damaged</Button>
          <Button size="sm" variant="ghost" onClick={() => onCheckIn(rental, 'missing')}>Missing</Button>
        </div>
      ) : (
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${rental.condition === 'ok' ? 'border-success/30 text-success' : 'border-danger/30 text-danger'}`}>
          {rental.condition === 'ok' ? 'Returned' : rental.condition}
        </span>
      )}
    </li>
  )
}

// Every rental not yet checked in, across all games.
export function StillOutPanel({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const canHandleGear = useCanHandleGear()
  const [outstanding, setOutstanding] = useState<Rental[] | null>(null)

  const load = useCallback(() => {
    apiGet<{ data: Rental[] }>('/api/rentals?status=out')
      .then((res) => {
        setOutstanding(res.data)
        onCountChange?.(res.data.length)
      })
      .catch(() => setOutstanding((current) => current || []))
  }, [onCountChange])

  useEffect(() => { load() }, [load])

  const onCheckIn = async (rental: Rental, condition: Condition) => {
    if (await checkInRental(rental, condition)) load()
  }

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center gap-2 text-sm font-bold">
        <FiAlertTriangle className="text-warning" /> Still out ({outstanding ? outstanding.length : '…'})
      </div>
      {outstanding === null ? (
        <div className="mt-3 text-sm text-muted">Loading rentals…</div>
      ) : outstanding.length === 0 ? (
        <div className="mt-3 text-sm text-muted">Every rental is checked in.</div>
      ) : (
        <Paged items={outstanding}>
          {(pageItems) => <ul className="mt-3 space-y-2">{pageItems.map((r) => <RentalRow key={r.id} rental={r} showReservation readOnly={!canHandleGear} onCheckIn={onCheckIn} />)}</ul>}
        </Paged>
      )}
    </Card>
  )
}

// Rentals for one booking: issue a unit to a player, and check each one back in.
// `active`: the tab is showing. Other tabs (Bill & ammo can add a gun) change rentals, so the
// panel reloads whenever it is shown again.
// `finished`: the game is over (completed or archived): only check-ins remain, nothing is handed out.
export function RentalsPanel({ reservationId, active = true, finished = false }: { reservationId: string; active?: boolean; finished?: boolean }) {
  // Registrars see who has what; only marshals (and admins) hand out and check in.
  const readOnly = !useCanHandleGear()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [inventory, setInventory] = useState<InventoryOption[]>([])
  const [rentals, setRentals] = useState<Rental[] | null>(null)
  const [reservedGuns, setReservedGuns] = useState<BookingWeapon[]>([])
  const [ownGunIds, setOwnGunIds] = useState<Set<string>>(new Set())
  // Guns and gear players bring from home, by player id.
  const [ownGear, setOwnGear] = useState<OwnItem[]>([])
  // "Guest" was chosen in the player list: a name is typed instead.
  const [guest, setGuest] = useState(false)
  // Suggested gun per player (player key -> "weapons:<id>"), changed by staff with Swap.
  const [suggested, setSuggested] = useState<Record<string, string>>({})
  const [outstanding, setOutstanding] = useState<Rental[]>([])
  const [form, setForm] = useState({ playerName: '', playerId: '' })
  // The piece picked in each slot ("" = nothing to hand out for that slot).
  const [picks, setPicks] = useState<Record<Slot, string>>({ gun: '', vest: '', mask: '' })
  const [busy, setBusy] = useState(false)
  const [inventoryState, setInventoryState] = useState<'loading' | 'ready' | 'error'>('loading')

  const loadOutstanding = useCallback(() => {
    apiGet<{ data: Rental[] }>('/api/rentals?status=out').then((res) => setOutstanding(res.data)).catch(() => null)
  }, [])

  // Every piece is its own record, so the inventory easily runs past one 200-record page: read it all.
  const loadInventory = useCallback(() => {
    setInventoryState('loading')
    Promise.all([apiGetAll<any>('weapons'), apiGetAll<any>('equipments')])
      .then(([w, e]) => {
        setInventory([...toInventoryOptions(w, 'weapons'), ...toInventoryOptions(e, 'equipments')])
        setInventoryState('ready')
      })
      .catch(() => {
        setInventoryState('error')
        toast.error('Could not load inventory')
      })
  }, [])

  const loadReservation = useCallback(async () => {
    try {
      const [ledger, list, weapons, own] = await Promise.all([
        apiGet<{ data: { reservation: { walkIn: boolean; walkInName: string; userId?: string; captainName?: string; teamMembers: TeamMember[]; ownWeaponBringerIds?: string[] } } }>(`/api/reservations/${encodeURIComponent(reservationId)}/ledger`),
        apiGet<{ data: Rental[] }>(`/api/rentals?reservationId=${encodeURIComponent(reservationId)}`),
        apiGet<{ data: BookingWeapon[] }>(`/api/reservations/${encodeURIComponent(reservationId)}/weapons`).catch(() => ({ data: [] as BookingWeapon[] })),
        apiGet<{ data: OwnItem[] }>(`/api/reservations/${encodeURIComponent(reservationId)}/own-gear`).catch(() => ({ data: [] as OwnItem[] })),
      ])
      setOwnGear(own.data)
      // Rental guns the booking reserved that haven't been handed to anyone yet.
      setReservedGuns(weapons.data.filter((w) => w.source === 'rental' && !w.rentedTo))
      const r = ledger.data.reservation
      setOwnGunIds(new Set((r.ownWeaponBringerIds || []).map(String)))
      setMembers(r.walkIn
        ? [{ id: '', name: r.walkInName }]
        : [...(r.captainName && r.userId ? [{ id: r.userId, name: r.captainName }] : []), ...(r.teamMembers || [])])
      setRentals(list.data)
    } catch (e: any) {
      toast.error(e?.message || 'Reservation not found')
      setRentals([])
    }
  }, [reservationId])

  // Load when shown, and again each time the tab is opened, so a gun added on the Bill tab (or
  // anything another staff member handed out) appears without reopening the game.
  useEffect(() => {
    if (!active) return
    loadOutstanding()
    loadInventory()
    void loadReservation()
  }, [active, loadOutstanding, loadInventory, loadReservation])

  // Pieces already handed out (from the rental records), so they can't be issued twice.
  const outByItemId = useMemo(() => new Map(outstanding.map((rental: any) => [String(rental.itemId || ''), rental])), [outstanding])
  const pieceFree = (item: InventoryOption) => item.status === 'available' && !outByItemId.has(item.id)

  // The three things a player is handed: a gun, a vest and a mask. Each slot lists only the free
  // pieces of its kind, lowest unit number first ("Vest #4 · Vests · EQ-V-004").
  const slotItems = useMemo(() => {
    const toCombo = (item: InventoryOption): ComboItem => ({
      key: `${item.collection}:${item.id}`,
      label: `${item.name}${item.unitNumber && !item.name.includes('#') ? ` #${item.unitNumber}` : ''}`,
      detail: `${categoryLabel(item.category)} · ${item.id}`,
    })
    const free = inventory.filter(pieceFree).sort((a, b) => a.name.localeCompare(b.name) || a.unitNumber - b.unitNumber)
    return {
      gun: free.filter((i) => i.collection === 'weapons' && !NOT_GUNS.includes(i.category)).map(toCombo),
      vest: free.filter((i) => i.collection === 'equipments' && i.category.includes('vest')).map(toCombo),
      mask: free.filter((i) => i.collection === 'equipments' && i.category.includes('mask')).map(toCombo),
    }
    // pieceFree only depends on outByItemId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, outByItemId])

  // Hands the player every filled slot (gun, vest, mask) in one go.
  const issue = async (event: React.FormEvent) => {
    event.preventDefault()
    const items = SLOTS
      .map(({ slot }) => inventory.find((i) => `${i.collection}:${i.id}` === picks[slot]))
      .filter((item): item is InventoryOption => Boolean(item))
    if (!items.length) return toast.error('Pick a gun, vest or mask.')
    setBusy(true)
    const given: string[] = []
    for (const item of items) {
      try {
        await apiPost('/api/rentals/issue', {
          reservationId,
          playerName: form.playerName,
          playerId: form.playerId,
          itemCollection: item.collection,
          itemId: item.id,
          unitLabel: item.unitNumber ? `#${item.unitNumber}` : '',
        })
        given.push(`${item.name}${item.unitNumber && !item.name.includes('#') ? ` #${item.unitNumber}` : ''}`)
      } catch (e: any) {
        toast.error(`${item.name}: ${e?.message || 'could not issue'}`)
      }
    }
    if (given.length) toast.success(`${given.join(', ')} issued to ${form.playerName}.`)
    // Clear the slots and move on to the next player still waiting for gear.
    setPicks({ gun: '', vest: '', mask: '' })
    setForm({ playerName: '', playerId: '' })
    setGuest(false)
    await loadReservation()
    loadOutstanding()
    setBusy(false)
  }

  const onCheckIn = async (rental: Rental, condition: Condition) => {
    if (await checkInRental(rental, condition)) {
      await loadReservation()
      loadOutstanding()
    }
  }

  const memberOptions = useMemo(() => members.filter((m) => m.name), [members])

  // Every player on the booking with what they hold, plus anyone given an item by name only
  // (a guest), so staff can see at a glance who has which gun.
  const byPlayer = useMemo(() => {
    const list = rentals || []
    const groups: Array<{ key: string; id: string; name: string; onBooking: boolean; items: Rental[] }> = memberOptions.map((m) => ({
      key: m.id || `name:${m.name}`,
      id: m.id,
      name: m.name,
      onBooking: true,
      items: list.filter((r) => (m.id && r.playerId ? r.playerId === m.id : r.playerName === m.name)),
    }))
    const shown = new Set(groups.flatMap((g) => g.items.map((r) => r.id)))
    const others = new Map<string, Rental[]>()
    for (const r of list) {
      if (shown.has(r.id)) continue
      others.set(r.playerName, [...(others.get(r.playerName) || []), r])
    }
    for (const [name, items] of others) groups.push({ key: `other:${name}`, id: '', name, onBooking: false, items })
    return groups
  }, [rentals, memberOptions])

  // ---- Suggested guns: the system proposes, the marshal confirms at handout --------------------
  // Free rental guns, the ones this booking reserved first.
  const reservedIds = useMemo(() => new Set(reservedGuns.map((g) => g.id)), [reservedGuns])
  const freeGuns = useMemo(
    () => inventory
      .filter((item) => item.collection === 'weapons' && !NOT_GUNS.includes(item.category) && pieceFree(item))
      .sort((a, b) => Number(reservedIds.has(b.id)) - Number(reservedIds.has(a.id)) || a.name.localeCompare(b.name) || a.unitNumber - b.unitNumber),
    // pieceFree only depends on outByItemId
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inventory, outByItemId, reservedIds],
  )
  const gunKey = (item: InventoryOption) => `${item.collection}:${item.id}`
  const gunLabel = (item: InventoryOption) => `${item.name}${item.unitNumber && !item.name.includes('#') ? ` #${item.unitNumber}` : ''}`

  // What each player brings from home, by slot: { gun: [MG], vest: [...] }.
  const ownBySlot = (playerId: string) => {
    const result: Partial<Record<Slot, OwnItem[]>> = {}
    for (const item of ownGear) {
      if (!playerId || item.playerId !== playerId) continue
      const slot = slotOfOwn(item)
      if (slot) result[slot] = [...(result[slot] || []), item]
    }
    return result
  }
  // A player brings their own gun when the booking says so or they registered one for it.
  const bringsOwn = (playerId: string, slot: Slot) =>
    Boolean(playerId) && (Boolean(ownBySlot(playerId)[slot]?.length) || (slot === 'gun' && ownGunIds.has(playerId)))

  // Players on the booking who rent (not bringing their own gun) and don't have a gun yet.
  // Nobody needs one once the game is finished, and a player who already had a gun this game
  // (even one since returned) is done.
  const needGun = useMemo(
    () => finished || readOnly ? [] : byPlayer.filter((p) => p.onBooking && !bringsOwn(p.id, 'gun')
      && !p.items.some((r) => r.itemCollection === 'weapons' && !NOT_GUNS.includes(String((r as any).itemCategory || '').toLowerCase()))),
    // bringsOwn only depends on ownGear and ownGunIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byPlayer, ownGunIds, ownGear, finished, readOnly],
  )

  // Hand each player who needs a gun the next reserved one. A gun a marshal swapped in stays,
  // unless it was handed to someone else in the meantime.
  useEffect(() => {
    if (inventoryState !== 'ready' || rentals === null) return
    setSuggested((current) => {
      const freeKeys = new Set(freeGuns.map(gunKey))
      const next: Record<string, string> = {}
      for (const p of needGun) if (current[p.key] && freeKeys.has(current[p.key])) next[p.key] = current[p.key]
      const used = new Set(Object.values(next))
      const pool = freeGuns.filter((g) => reservedIds.has(g.id) && !used.has(gunKey(g)))
      for (const p of needGun) {
        if (next[p.key]) continue
        const gun = pool.shift()
        if (gun) next[p.key] = gunKey(gun)
      }
      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })
  }, [needGun, freeGuns, reservedIds, inventoryState, rentals])

  const issueGun = (player: { id: string; name: string }, itemKey: string) => {
    const item = inventory.find((i) => gunKey(i) === itemKey)
    if (!item) throw new Error('Choose a gun.')
    return apiPost('/api/rentals/issue', {
      reservationId,
      playerName: player.name,
      playerId: player.id,
      itemCollection: item.collection,
      itemId: item.id,
      unitLabel: item.unitNumber ? `#${item.unitNumber}` : '',
    }).then(() => item)
  }

  const confirmGun = async (player: { key: string; id: string; name: string }) => {
    setBusy(true)
    try {
      const item = await issueGun(player, suggested[player.key])
      toast.success(`${gunLabel(item)} handed to ${player.name}.`)
    } catch (e: any) {
      toast.error(e?.message || 'Could not hand out the gun')
    } finally {
      await loadReservation()
      loadOutstanding()
      setBusy(false)
    }
  }

  const confirmAll = async () => {
    const ready = needGun.filter((p) => suggested[p.key])
    setBusy(true)
    let done = 0
    for (const player of ready) {
      try {
        await issueGun(player, suggested[player.key])
        done += 1
      } catch (e: any) {
        toast.error(`${player.name}: ${e?.message || 'could not hand out the gun'}`)
      }
    }
    if (done) toast.success(`Handed out ${done} gun${done === 1 ? '' : 's'}.`)
    await loadReservation()
    loadOutstanding()
    setBusy(false)
  }
  const readyCount = needGun.filter((p) => suggested[p.key]).length

  // Picking a player fills each slot they still need: their suggested gun (none if they bring
  // their own or already have one), and the next free vest and mask.
  const prefillFor = (member: TeamMember) => {
    const key = member.id || `name:${member.name}`
    const holding = (rentals || []).filter((r) => r.status === 'out' && (member.id && r.playerId ? r.playerId === member.id : r.playerName === member.name))
    const has = (slot: Slot) => holding.some((r) => {
      const item = inventory.find((i) => i.id === (r as any).itemId)
      if (slot === 'gun') return r.itemCollection === 'weapons'
      return Boolean(item?.category.includes(slot)) || r.itemName.toLowerCase().includes(slot)
    })
    const needsGun = needGun.some((p) => p.key === key)
    const firstFree = (slot: Slot) => slotItems[slot][0]?.key || ''
    setPicks({
      gun: needsGun ? suggested[key] || '' : '',
      vest: has('vest') || bringsOwn(member.id, 'vest') ? '' : firstFree('vest'),
      mask: has('mask') || bringsOwn(member.id, 'mask') ? '' : firstFree('mask'),
    })
  }

  // Slots the chosen player brings themselves are left out of the form, with what they bring.
  const ownForForm = ownBySlot(form.playerId)

  return (
    <div className={finished || readOnly ? 'space-y-4' : 'grid gap-4 lg:grid-cols-[0.9fr_1.1fr]'}>
      {finished || readOnly ? null : (
      <Card className="h-fit p-4">
        <form className="space-y-3" onSubmit={issue}>
          <div className="flex items-center gap-2 text-sm font-bold"><FiLogOut /> Issue gear</div>
          <label className="block">
            <div className="mb-2 text-sm font-semibold">Player</div>
            <select
              value={guest ? 'guest' : form.playerId ? `id:${form.playerId}` : form.playerName ? `name:${form.playerName}` : ''}
              onChange={(e) => {
                const value = e.target.value
                if (value === 'guest') {
                  setGuest(true)
                  setForm({ playerId: '', playerName: '' })
                  prefillFor({ id: '', name: '' })
                  return
                }
                setGuest(false)
                const member = memberOptions.find((m) => `id:${m.id}` === value || `name:${m.name}` === value)
                setForm({ playerId: member?.id || '', playerName: member?.name || '' })
                if (member) prefillFor(member)
                else setPicks({ gun: '', vest: '', mask: '' })
              }}
              className={selectClass}
            >
              <option value="">Choose a player…</option>
              {memberOptions.map((m) => <option key={m.id || m.name} value={m.id ? `id:${m.id}` : `name:${m.name}`}>{m.name}</option>)}
              <option value="guest">Someone not on this booking…</option>
            </select>
          </label>
          {guest ? (
            <Input label="Guest's name" value={form.playerName} onChange={(e) => setForm((f) => ({ ...f, playerName: e.target.value }))} />
          ) : null}
          {inventoryState === 'loading' ? <div className="text-xs text-muted">Loading inventory…</div> : null}
          {inventoryState === 'error' ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              Could not load the inventory.
              <Button size="xs" variant="ghost" type="button" onClick={loadInventory}>Try again</Button>
            </div>
          ) : null}
          {inventoryState === 'ready' && (form.playerId || guest || form.playerName) ? (
            <div className="space-y-3">
              {SLOTS.map(({ slot, label, placeholder }) => bringsOwn(form.playerId, slot) ? (
                <div key={slot}>
                  <div className="mb-2 text-sm font-semibold">{label}</div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted">
                    Brings their own{ownForForm[slot]?.length ? `: ${ownForForm[slot]!.map((i) => i.name).join(', ')}` : ''}
                  </div>
                </div>
              ) : (
                <div key={slot} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <ItemCombobox
                      label={label}
                      items={slotItems[slot]}
                      selectedKey={picks[slot]}
                      onSelect={(item) => setPicks((p) => ({ ...p, [slot]: item?.key || '' }))}
                      placeholder={slotItems[slot].length ? placeholder : `No free ${label.toLowerCase()}s`}
                    />
                  </div>
                  {picks[slot] ? (
                    <button
                      type="button"
                      onClick={() => setPicks((p) => ({ ...p, [slot]: '' }))}
                      className="mb-2.5 rounded-lg p-1.5 text-muted transition hover:bg-white/10 hover:text-text"
                      aria-label={`Don't hand out a ${label.toLowerCase()}`}
                      title={`Skip the ${label.toLowerCase()}`}
                    >
                      <FiX />
                    </button>
                  ) : null}
                </div>
              ))}
              <p className="text-xs text-muted">Filled in with their suggested gun and the next free vest and mask. Clear any slot they don't need.</p>
            </div>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy || !form.playerName.trim() || !SLOTS.some(({ slot }) => picks[slot])}>
            {busy ? 'Saving…' : `Issue ${SLOTS.filter(({ slot }) => picks[slot]).map(({ label }) => label.toLowerCase()).join(', ') || 'gear'}`}
          </Button>
        </form>
      </Card>
      )}

      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold">Players and their gear</div>
            {readOnly ? <span className="text-xs text-muted">View only: marshals hand out and check in guns and gear.</span>
              : finished ? <span className="text-xs text-muted">Game finished: check in what's still out.</span> : null}
            {readyCount > 1 ? (
              <Button size="sm" type="button" disabled={busy} onClick={() => void confirmAll()}>
                <FiCheck /> Confirm all ({readyCount})
              </Button>
            ) : null}
          </div>
          {needGun.length > 0 ? (
            <p className="mt-1 text-xs text-muted">Each player who rents gets a suggested gun. Hand it over and press Confirm, or swap it first if it's faulty or doesn't suit them.</p>
          ) : null}
          {rentals === null ? (
            <div className="mt-3 text-sm text-muted">Loading…</div>
          ) : byPlayer.length === 0 ? (
            <div className="mt-3 text-sm text-muted">No players on this booking yet.</div>
          ) : (
            <ul className="mt-3 space-y-3">
              {byPlayer.map((player) => {
                const ownGun = bringsOwn(player.id, 'gun')
                const own = player.id ? ownGear.filter((item) => item.playerId === player.id) : []
                const waiting = needGun.some((p) => p.key === player.key)
                const choice = suggested[player.key] || ''
                return (
                  <li key={player.key} className="rounded-xl border border-white/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{player.name}</span>
                      {ownGun ? (
                        <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted">Own gun</span>
                      ) : waiting ? (
                        <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-warning">No gun yet</span>
                      ) : null}
                    </div>
                    {own.length ? (
                      <div className="mt-1 text-xs text-muted">Brings: {own.map((item) => item.name).join(', ')}</div>
                    ) : null}

                    {waiting ? (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select
                          value={choice}
                          onChange={(e) => setSuggested((current) => ({ ...current, [player.key]: e.target.value }))}
                          className={`${selectClass} sm:flex-1`}
                          disabled={inventoryState !== 'ready' || busy}
                          aria-label={`Gun for ${player.name}`}
                        >
                          <option value="">{inventoryState === 'ready' ? 'Choose a gun…' : 'Loading guns…'}</option>
                          {(['reserved', 'other'] as const).map((group) => {
                            const options = freeGuns.filter((g) => (group === 'reserved') === reservedIds.has(g.id))
                            if (!options.length) return null
                            return (
                              <optgroup key={group} label={group === 'reserved' ? 'Reserved for this booking' : 'Other free guns'}>
                                {options.map((g) => {
                                  const takenBy = Object.entries(suggested).find(([key, value]) => value === gunKey(g) && key !== player.key)
                                  return (
                                    <option key={g.id} value={gunKey(g)} disabled={Boolean(takenBy)}>
                                      {gunLabel(g)} · {g.id}{takenBy ? ' (suggested for someone else)' : ''}
                                    </option>
                                  )
                                })}
                              </optgroup>
                            )
                          })}
                        </select>
                        <Button size="sm" type="button" disabled={busy || !choice} onClick={() => void confirmGun(player)}>
                          <FiCheck /> Confirm
                        </Button>
                      </div>
                    ) : null}

                    {player.items.length ? (
                      <ul className="mt-2 space-y-1.5">{player.items.map((r) => <RentalRow key={r.id} rental={r} hidePlayer readOnly={readOnly} onCheckIn={onCheckIn} />)}</ul>
                    ) : !waiting ? (
                      <div className="mt-1 text-xs text-muted">Nothing issued.</div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
