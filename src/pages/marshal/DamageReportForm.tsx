import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FiUser } from 'react-icons/fi'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { ItemCombobox, type ComboItem } from '../../components/ui/ItemCombobox'
import { apiGet, apiGetAll, apiPost } from '../../utils/apiClient'

export type InventoryItem = { id: string; name: string }

type Game = {
  id: string
  reservationDate?: string
  reservationTime?: string
  reservationStatus?: string
  locationName?: string
  bookerName?: string
  walkInName?: string
  teamMembers?: Array<{ name?: string }>
}

// A center weapon or gear piece used in the game (see GET /api/reservations/:id/game-items).
// playerName is set when the piece is bound to a player: handed to them at Rentals, or the game
// has only one player.
type GameItem = {
  collection: 'weapons' | 'equipments'
  itemId: string
  name: string
  source: 'rental' | 'booked' | 'own'
  rentalId: string
  rentalStatus: string
  playerName: string
  playerId: string
  reportedId: string
}
type GamePlayer = { id: string; name: string }

export type FiledReport = { data: { id: string }; repair?: { id: string } | null; kind: 'damage' | 'loss' }

const SLOT_ORDER = ['morning', 'afternoon', 'evening', 'night']
const selectClass = 'w-full rounded-xl border border-white/10 bg-background px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 [&>option]:bg-background'
const manilaTodayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const toOption = (item: InventoryItem): ComboItem => ({ key: item.id, label: item.name, detail: item.id })

function gameLabel(game: Game) {
  const who = game.bookerName || game.walkInName || game.teamMembers?.find((m) => m?.name)?.name || game.id
  return `${capitalize(game.reservationTime || 'today')} · ${who}`
}

// Filing a damage or loss report, in the order staff work it out:
//   1. the game (today's games are suggested; any reservation ID works),
//   2. the broken or lost item, from the weapons and gear used in that game,
//   3. the responsible player, filled in from whoever the item is bound to.
// An item that isn't listed can still be picked from the inventory, with the player chosen from the game.
export function DamageReportForm({ weapons, equipment, onFiled }: {
  weapons: InventoryItem[]
  equipment: InventoryItem[]
  onFiled: (result: FiledReport) => void
}) {
  // 1. Game
  const [todaysGames, setTodaysGames] = useState<Game[]>([])
  const [pickedGameId, setPickedGameId] = useState('')
  const [typedGameId, setTypedGameId] = useState('')
  const gameId = pickedGameId || typedGameId.trim()
  const [game, setGame] = useState<Game | null>(null)
  const [gameItems, setGameItems] = useState<GameItem[]>([])
  const [players, setPlayers] = useState<GamePlayer[]>([])
  const [gameState, setGameState] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle')

  // 2–3. Item and player
  const [itemKey, setItemKey] = useState('')
  const [manualItem, setManualItem] = useState(false)
  const [itemType, setItemType] = useState<'weapon' | 'equipment'>('weapon')
  const [itemId, setItemId] = useState('')
  const [itemName, setItemName] = useState('')
  const [playerName, setPlayerName] = useState('')

  const [kind, setKind] = useState<'damage' | 'loss'>('damage')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const q = encodeURIComponent(JSON.stringify({ reservationDate: manilaTodayISO() }))
    apiGetAll<Game>('reservations', `q=${q}`)
      .then((docs) => setTodaysGames(docs
        .filter((doc) => doc.id && String(doc.reservationStatus || '').toLowerCase() !== 'cancelled')
        .sort((a, b) => SLOT_ORDER.indexOf(String(a.reservationTime || '').toLowerCase()) - SLOT_ORDER.indexOf(String(b.reservationTime || '').toLowerCase()))))
      .catch(() => setTodaysGames([]))
  }, [])

  // Load the game and the items used in it. A typed ID waits until typing pauses.
  useEffect(() => {
    setItemKey('')
    setManualItem(false)
    setItemId('')
    setItemName('')
    setPlayerName('')
    if (!gameId) {
      setGame(null)
      setGameItems([])
      setPlayers([])
      setGameState('idle')
      return
    }
    let active = true
    setGameState('loading')
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiGet<{ ok: boolean; data: Game }>(`/api/reservations/${encodeURIComponent(gameId)}`)
        const found = res.data
        const itemsRes = await apiGet<{ ok: boolean; data: { items: GameItem[]; players: GamePlayer[] } }>(`/api/reservations/${encodeURIComponent(found.id)}/game-items`)
        if (!active) return
        // Players' own gear isn't the center's to bill for.
        const items = (itemsRes.data?.items || []).filter((item) => item.source !== 'own')
        setGame(found)
        setGameItems(items)
        setPlayers(itemsRes.data?.players || [])
        // No weapons or gear on record for this game: pick the item from the inventory instead.
        setManualItem(items.length === 0)
        setGameState('ready')
      } catch {
        if (!active) return
        setGame(null)
        setGameItems([])
        setPlayers([])
        setGameState('missing')
      }
    }, pickedGameId ? 0 : 400)
    return () => { active = false; window.clearTimeout(timer) }
  }, [gameId, pickedGameId])

  const gameOptions: ComboItem[] = useMemo(() => todaysGames.map((g) => ({
    key: g.id,
    label: gameLabel(g),
    detail: [g.id, g.locationName].filter(Boolean).join(' · '),
  })), [todaysGames])

  const openItems = gameItems.filter((item) => !item.reportedId)
  const reportedCount = gameItems.length - openItems.length
  const itemOptions: ComboItem[] = openItems.map((item) => ({
    key: `${item.collection}:${item.itemId}`,
    label: item.name,
    detail: [
      item.collection === 'weapons' ? 'Weapon' : 'Gear',
      item.playerName || 'not handed out yet',
      item.rentalStatus === 'out' ? 'still out' : '',
    ].filter(Boolean).join(' · '),
  }))
  const picked = openItems.find((item) => `${item.collection}:${item.itemId}` === itemKey) || null
  // The picked item is bound to a player: the report goes to them.
  const boundPlayer = picked?.playerName ? picked : null
  const playerOptions: ComboItem[] = players.map((p, index) => ({ key: p.name, label: p.name, detail: index === 0 ? 'Booked it' : undefined }))
  const inventoryOptions = (itemType === 'weapon' ? weapons : equipment).map(toOption)
  // Who the report goes to: the bound player, or the one chosen below.
  const responsible = boundPlayer ? boundPlayer.playerName : playerName.trim()

  const canFile = Boolean(
    game
    && description.trim()
    && responsible
    && (picked || (manualItem && (itemId || itemName.trim()))),
  )

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!game || !canFile) return
    setSaving(true)
    try {
      const chosenPlayer = players.find((p) => p.name === responsible)
      const body = picked
        ? picked.rentalId
          ? { kind, reservationId: game.id, rentalId: picked.rentalId, itemType: picked.collection === 'weapons' ? 'weapon' : 'equipment', description }
          : { kind, reservationId: game.id, itemType: picked.collection === 'weapons' ? 'weapon' : 'equipment', itemId: picked.itemId, itemName: picked.name, playerName: responsible, playerId: picked.playerId || chosenPlayer?.id || '', description }
        : { kind, reservationId: game.id, itemType, itemId, itemName, playerName: responsible, playerId: chosenPlayer?.id || '', description }
      const res = await apiPost<{ ok: boolean; data: { id: string }; repair?: { id: string } | null }>('/api/damage-reports', body)
      onFiled({ data: res.data, repair: res.repair, kind })
    } catch (err: any) {
      toast.error(err?.message || 'Unable to file report')
    } finally {
      setSaving(false)
    }
  }

  const stepLabel = (step: number, text: string) => (
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/15 text-[11px] font-bold text-accent">{step}</span>
      {text}
    </div>
  )
  const waiting = (text: string) => <div className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-sm text-muted">{text}</div>

  return (
    <form className="space-y-4" onSubmit={submit}>
      {/* 1. Game */}
      <div>
        {stepLabel(1, 'Game')}
        <ItemCombobox
          label=""
          placeholder={todaysGames.length ? "Pick one of today's games, or type a reservation ID" : 'Type a reservation ID, e.g. R-…'}
          items={gameOptions}
          selectedKey={pickedGameId}
          onSelect={(item) => setPickedGameId(item?.key || '')}
          allowCustom
          customText={typedGameId}
          onCustomText={setTypedGameId}
        />
        <div className="mt-1 text-xs text-muted">
          {gameState === 'missing'
            ? <span className="text-danger">No reservation with that ID.</span>
            : gameState === 'loading'
              ? 'Loading the game…'
              : game && !pickedGameId
                ? `${gameLabel(game)} · ${game.reservationDate || ''}${game.locationName ? ` · ${game.locationName}` : ''}`
                : todaysGames.length
                  ? `${todaysGames.length} game${todaysGames.length === 1 ? '' : 's'} today. For an older game, type its reservation ID.`
                  : 'No games today. Type the reservation ID of the game the item was used in.'}
        </div>
      </div>

      {/* 2. Item */}
      <div>
        {stepLabel(2, 'Broken or lost item')}
        {!game ? waiting('Pick the game first to see the weapons and gear used in it.') : !manualItem ? (
          <>
            <ItemCombobox
              key={`items-${game.id}`}
              label=""
              placeholder={`Pick one of the ${openItems.length} item${openItems.length === 1 ? '' : 's'} used in this game`}
              items={itemOptions}
              selectedKey={itemKey}
              onSelect={(item) => { setItemKey(item?.key || ''); setPlayerName('') }}
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>{reportedCount ? `${reportedCount} already reported. ` : ''}Weapons and gear booked or handed out for this game.</span>
              <button type="button" onClick={() => { setManualItem(true); setItemKey('') }} className="font-semibold text-accent hover:underline">Item not on this list?</button>
            </div>
          </>
        ) : (
          <>
            {gameItems.length === 0 ? (
              <div className="mb-2 text-xs text-muted">No weapons or gear are on record for this game, so pick the item from the inventory.</div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <select
                value={itemType}
                onChange={(e) => { setItemType(e.target.value as 'weapon' | 'equipment'); setItemId(''); setItemName('') }}
                className={selectClass}
                aria-label="Item type"
              >
                <option value="weapon">Weapon</option>
                <option value="equipment">Gear</option>
              </select>
              <ItemCombobox
                key={`inventory-${itemType}`}
                label=""
                placeholder={itemType === 'weapon' ? 'Type or pick a weapon' : 'Type or pick gear'}
                items={inventoryOptions}
                selectedKey={itemId}
                onSelect={(item) => setItemId(item?.key || '')}
                allowCustom
                customText={itemName}
                onCustomText={setItemName}
              />
            </div>
            {gameItems.length > 0 ? (
              <button type="button" onClick={() => { setManualItem(false); setItemId(''); setItemName(''); setPlayerName('') }} className="mt-1 text-xs font-semibold text-accent hover:underline">
                Back to the items used in this game
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* 3. Player */}
      <div>
        {stepLabel(3, 'Responsible player')}
        {!game || (!picked && !manualItem) ? waiting('Filled in from the item once it is picked.') : boundPlayer ? (
          <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
            <FiUser className="h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{boundPlayer.playerName}</div>
              <div className="text-xs text-muted">
                {boundPlayer.source === 'rental'
                  ? `Had ${boundPlayer.name} in this game (rental ${boundPlayer.rentalId})`
                  : `The only player in this game, so ${boundPlayer.name} was theirs`}
              </div>
            </div>
          </div>
        ) : (
          <>
            {picked ? (
              <div className="mb-2 text-xs text-muted">{picked.name} was booked for the group but not handed to anyone at Rentals, so choose who had it.</div>
            ) : null}
            {playerOptions.length > 0 ? (
              <ItemCombobox
                key={`player-${game.id}-${itemKey}`}
                label=""
                placeholder={`Pick one of the ${playerOptions.length} player${playerOptions.length === 1 ? '' : 's'} in this game`}
                items={playerOptions}
                selectedKey={playerName}
                onSelect={(item) => setPlayerName(item?.key || '')}
              />
            ) : (
              <Input placeholder="Name of the player who had it" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
            )}
          </>
        )}
      </div>

      {/* 4. What happened */}
      <div>
        {stepLabel(4, 'What happened')}
        <div className="mb-2 grid grid-cols-2 gap-2">
          {([['damage', 'Damaged'], ['loss', 'Lost']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              aria-pressed={kind === value}
              className={[
                'rounded-xl border px-3 py-2 text-sm font-semibold transition',
                kind === value ? 'border-accent/40 bg-accent/15 text-accent' : 'border-white/10 bg-white/5 text-muted hover:text-text',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
          rows={3}
          placeholder={kind === 'loss' ? 'e.g. Not returned after the game.' : 'e.g. Trigger stuck, cracked stock.'}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>

      <Button type="submit" className="w-full" disabled={saving || !canFile}>
        {saving ? 'Saving…' : 'File report'}
      </Button>
    </form>
  )
}
