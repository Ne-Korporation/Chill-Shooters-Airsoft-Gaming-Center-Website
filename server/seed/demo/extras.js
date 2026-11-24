// Demo records around the bookings: the calendar (cause days, closed days), the CvSU partnership,
// money (operating expenses, donation fund, partner loans), and communication (announcements,
// contact messages, notifications, weather advisories) plus the audit log.

import { computeNetRevenue, paymentDay, isCollected } from '../../utils/reachNetRevenue.js'
import { CVSU_NAME } from '../../utils/bookingPricing.js'
import { DAY, DEMO_EMAIL_DOMAIN, DEMO_FLAG, HOUR, actor, addDays, atManila, counter, dayOfWeek, posterSvg, round2 } from './lib.js'

// Runs before the bookings: a past game for a cause (bookings that day record it), closed days
// ahead, and the CvSU partnership record.
export function calendarAndPartners({ now, todayISO, staff, historyStart }) {
  const by = { id: String(staff.owner.id), email: staff.owner.email, role: 'admin' }
  const causeDays = []
  const closedDays = []
  const auditLogs = []

  // A Saturday in October: a game for a cause.
  let causeDate = addDays(historyStart, 70)
  while (dayOfWeek(causeDate) !== 6) causeDate = addDays(causeDate, 1)
  if (causeDate < todayISO) {
    const setISO = new Date(atManila(addDays(causeDate, -16), '10:15')).toISOString()
    const cause = {
      dateISO: causeDate, active: true, title: 'Typhoon Relief for Brgy. Salawag', description: 'Half of the day\'s game fees go to relief packs for families affected by the typhoon.',
      beneficiary: 'Brgy. Salawag Disaster Response Council', donationPercent: 50, createdAtISO: setISO, createdBy: by, updatedAtISO: setISO, updatedBy: by,
      history: [{ action: 'set', atISO: setISO, title: 'Typhoon Relief for Brgy. Salawag', description: '', beneficiary: 'Brgy. Salawag Disaster Response Council', donationPercent: 50, by }],
      ...DEMO_FLAG,
    }
    causeDays.push(cause)
    auditLogs.push({ action: 'cause_day_set', resourceType: 'cause_days', resourceId: causeDate, actorId: by.id, actorRole: 'admin', details: { title: cause.title, donationPercent: 50 }, createdAtISO: setISO, ...DEMO_FLAG })
  }

  // Closed for the holidays.
  const year = Number(todayISO.slice(0, 4))
  for (const [dateISO, reason] of [[`${year}-12-24`, 'Christmas Eve: field closed'], [`${year}-12-25`, 'Christmas Day: field closed'], [`${year + 1}-01-01`, 'New Year\'s Day: field closed']]) {
    if (dateISO <= todayISO) continue
    const atISO = new Date(now - 6 * DAY).toISOString()
    const who = { actorId: String(staff.owner.id), actorEmail: staff.owner.email, actorRole: 'admin' }
    closedDays.push({ dateISO, reason, active: true, createdAtISO: atISO, createdBy: who, updatedAtISO: atISO, updatedBy: who, history: [{ action: 'closed', atISO, reason, by: who }], ...DEMO_FLAG })
    auditLogs.push({ action: 'closed_day_set', resourceType: 'closed_days', resourceId: dateISO, actorId: who.actorId, actorRole: 'admin', details: { reason }, createdAtISO: atISO, ...DEMO_FLAG })
  }

  const cvsu = {
    name: CVSU_NAME, type: 'school', contactName: 'Office of Student Affairs', contactEmail: `osa@${DEMO_EMAIL_DOMAIN}`,
    status: 'active', revenueSharePercent: 0, discountPercent: 10,
    notes: 'Student discount on bookings for CvSU students with a verified student ID.', createdAtISO: new Date(atManila(historyStart, '09:00') - 30 * DAY).toISOString(), ...DEMO_FLAG,
  }
  return { causeDays, closedDays, partnerships: [cvsu], auditLogs }
}

// Operating expenses sized to each month's takings (a small, profitable field), recorded on the
// days they were paid. Repair parts come from the actual repair log.
export function buildExpenses({ payments, expenseHints = [], historyStart, todayISO, staff, rng }) {
  const nextId = counter('EXP')
  const months = []
  for (let m = historyStart.slice(0, 7); m <= todayISO.slice(0, 7);) {
    months.push(m)
    const [y, mo] = m.split('-').map(Number)
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  }
  const collectedIn = (month) => round2(payments.filter((p) => isCollected(p) && paymentDay(p).startsWith(month)).reduce((s, p) => s + Number(p.amount || 0), 0))
  const expenses = []
  const by = [staff.owner, staff.admin]
  const add = (dateISO, category, amount, description, vendor) => {
    if (dateISO > todayISO || amount <= 0) return
    const recorder = rng.pick(by)
    expenses.push({
      id: nextId(), dateISO, category, amount: Math.round(amount / 50) * 50 || 50, description, vendor, receiptUrl: '',
      atISO: new Date(atManila(dateISO, '17:30')).toISOString(), recordedBy: actor(recorder), ...DEMO_FLAG,
    })
  }
  for (const month of months) {
    const collected = collectedIn(month)
    // Full months: about 55% of takings goes to running costs; the current month so far, less.
    const budget = collected * (month === todayISO.slice(0, 7) ? 0.45 : 0.55)
    add(`${month}-05`, 'rent', budget * 0.3, 'Monthly lease: Salawag field', 'Dela Paz Property Leasing')
    add(`${month}-15`, 'salaries', budget * 0.19, 'Marshal and front desk pay (1st half)', '')
    add(`${month}-28`, 'salaries', budget * 0.19, 'Marshal and front desk pay (2nd half)', '')
    add(`${month}-10`, 'utilities', budget * 0.08, 'Electricity: field lights and charging station', 'Meralco')
    add(`${month}-12`, 'utilities', budget * 0.02, 'Water', 'Dasmariñas Water District')
    add(`${month}-08`, 'supplies', budget * 0.08, '0.25 g BBs (20 bags) and green gas', 'Cavite Airsoft Supply')
    add(`${month}-20`, 'supplies', budget * 0.04, 'Anti-fog spray, armbands, first-aid restock', 'Watsons / Ace Hardware')
    add(`${month}-03`, 'marketing', budget * 0.05, 'Facebook and Instagram ads', 'Meta')
    add(`${month}-25`, 'other', budget * 0.05, 'Field cleanup and grass cutting', 'Barangay crew')
  }
  for (const hint of expenseHints) add(hint.dateISO, 'repairs_parts', hint.amount, hint.description, 'Gunsmith')
  return expenses
}

// The donation fund: monthly allocations from net revenue (worked out by the server's own
// computeNetRevenue once payments and expenses are in), outside donations, and spending on
// community programs.
export async function buildReachFund({ db, ratePercent, historyStart, todayISO, staff }) {
  const entries = []
  const programs = []
  const owner = actor(staff.owner)
  const months = []
  for (let m = historyStart.slice(0, 7); m < todayISO.slice(0, 7);) {
    months.push(m)
    const [y, mo] = m.split('-').map(Number)
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  }
  for (const month of months) {
    const breakdown = await computeNetRevenue(db, month, ratePercent)
    if (!(breakdown.allocation > 0)) continue
    const [y, mo] = month.split('-').map(Number)
    const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
    entries.push({
      type: 'allocation', periodKey: month, amount: breakdown.allocation, ratePercent, netRevenue: breakdown,
      description: `${ratePercent}% of ${month} net revenue (₱${breakdown.netRevenue.toLocaleString()})`,
      dateISO: breakdown.range.end, atISO: new Date(atManila(`${next}-03`, '09:00')).toISOString(), recordedBy: owner, ...DEMO_FLAG,
    })
  }
  const allocated = entries.reduce((s, e) => s + e.amount, 0)

  const programDefs = [
    { id: 'RCH-000001', title: 'Airsoft Safety Clinic for SK Youth', offset: 55, status: 'completed', venue: 'Chill Shooters Salawag', beneficiaries: 'Sangguniang Kabataan of Brgy. Salawag', participants: 35, partner: 'SK Salawag', spend: 0.55 },
    { id: 'RCH-000002', title: 'Relief Packs for Typhoon-Affected Families', offset: 85, status: 'completed', venue: 'Brgy. Salawag Covered Court', beneficiaries: '60 families in Brgy. Salawag', participants: 12, partner: 'Brgy. Salawag Disaster Response Council', spend: 0.7 },
    { id: 'RCH-000003', title: 'Christmas Fun Day with Bahay Pag-asa', offset: null, status: 'planned', venue: 'Chill Shooters Salawag', beneficiaries: 'Children of Bahay Pag-asa Dasmariñas', participants: 40, partner: 'Bahay Pag-asa', spend: 0 },
  ]
  const donations = [
    { offset: 42, amount: 5000, donorName: 'Cavite Outdoor Supply Co.', description: 'Donation for the youth safety clinic' },
    { offset: 78, amount: 3000, donorName: 'CvSU Airsoft Club Alumni', description: 'Donation for typhoon relief' },
  ]
  for (const d of donations) {
    const dateISO = addDays(historyStart, d.offset)
    if (dateISO >= todayISO) continue
    entries.push({ type: 'donation', amount: d.amount, description: d.description, donorName: d.donorName, dateISO, atISO: new Date(atManila(dateISO, '15:00')).toISOString(), recordedBy: owner, ...DEMO_FLAG })
  }
  const donated = entries.filter((e) => e.type === 'donation').reduce((s, e) => s + e.amount, 0)
  let balance = allocated + donated
  for (const p of programDefs) {
    const dateISO = p.offset === null ? `${todayISO.slice(0, 4)}-12-19` : addDays(historyStart, p.offset)
    const createdISO = new Date(atManila(p.offset === null ? addDays(todayISO, -8) : addDays(dateISO, -20), '11:00')).toISOString()
    programs.push({
      id: p.id, title: p.title, dateISO, status: p.status, venue: p.venue, beneficiaries: p.beneficiaries, participants: p.participants,
      partnerOrganization: p.partner, description: '', photoUrls: [], createdAtISO: createdISO, updatedAtISO: createdISO, createdBy: owner, ...DEMO_FLAG,
    })
    if (p.status === 'completed' && dateISO < todayISO) {
      const amount = Math.floor(Math.min(balance * p.spend, balance) / 50) * 50
      if (amount > 0) {
        entries.push({ type: 'expenditure', amount, description: p.title, donorName: null, programId: p.id, dateISO, atISO: new Date(atManila(dateISO, '18:00')).toISOString(), recordedBy: owner, ...DEMO_FLAG })
        balance -= amount
      }
    }
  }
  return { entries, programs }
}

export function buildPartnerLoans({ partner, historyStart, todayISO, staff }) {
  if (!partner) return []
  const owner = actor(staff.owner)
  const marshal = actor(staff.marshal2)
  const loans = []
  const add = (n, def) => loans.push({
    id: `LOAN-${String(n).padStart(6, '0')}`, partnerId: String(partner._id), partnerName: partner.name, documents: [], notes: '', ...def,
    createdAtISO: new Date(atManila(def.borrowedOn, '09:30')).toISOString(), createdBy: owner, ...DEMO_FLAG,
  })
  const d1 = addDays(historyStart, 48)
  add(1, { direction: 'borrowed_from_partner', borrowedOn: d1, dueOn: addDays(d1, 2), items: [{ description: 'VSR-10 sniper rifle', quantity: 2, collection: '', itemId: '', conditionOut: 'Good' }], status: 'returned', returnedOn: addDays(d1, 2), conditionIn: 'Good, cleaned and oiled', returnedAtISO: new Date(atManila(addDays(d1, 2), '18:00')).toISOString(), returnedBy: marshal, notes: 'For the CvSU club tournament weekend.' })
  const d2 = addDays(historyStart, 75)
  add(2, { direction: 'lent_to_partner', borrowedOn: d2, dueOn: addDays(d2, 3), items: [{ description: 'Full-face mask', quantity: 10, collection: 'equipments', itemId: '', conditionOut: 'Good' }], status: 'returned', returnedOn: addDays(d2, 3), conditionIn: 'Good; one strap replaced by the partner', returnedAtISO: new Date(atManila(addDays(d2, 3), '17:00')).toISOString(), returnedBy: marshal })
  const d3 = addDays(todayISO, -4)
  add(3, { direction: 'borrowed_from_partner', borrowedOn: d3, dueOn: addDays(todayISO, 6), items: [{ description: 'M249 support gun', quantity: 1, collection: '', itemId: '', conditionOut: 'Good' }, { description: 'Chronograph (spare)', quantity: 1, collection: '', itemId: '', conditionOut: 'Good' }], status: 'out', notes: 'For the weekend private games.' })
  return loans
}

export function buildComms({ now, todayISO, staff, files, people, reservations, gameplay, payments, rng }) {
  const posts = []
  const messages = []
  const notifications = []
  const advisories = []
  const nextPost = counter('D')
  const nextN = counter('N')

  const postDefs = [
    { daysAgo: 52, message: 'New at Salawag: the Forest field is open! More cover, more trees, more fun. Book a private game on weekdays.', poster: { title: 'The Forest Field Is Open', subtitle: 'Private games on weekdays' } },
    { daysAgo: 24, message: 'CvSU students get 10% off every booking. Verify your student ID on your profile to unlock it.', poster: { title: 'CvSU Students: 10% Off', subtitle: 'Verify your student ID on your profile' } },
    { daysAgo: 3, message: 'Holiday schedule: we are closed on Dec 24, Dec 25 and Jan 1. Weekend public games continue all December. See you on the field!', poster: null },
  ]
  for (const p of postDefs) {
    const atISO = new Date(now - p.daysAgo * DAY).toISOString()
    const imageUrl = p.poster ? files.add({ key: `post-${p.daysAgo}`, filename: 'announcement.svg', svg: posterSvg(p.poster), uploadedBy: staff.owner.id, createdAtISO: atISO }) : undefined
    posts.push({ id: nextPost(), message: p.message, ...(imageUrl ? { imageUrl } : {}), postedAtISO: atISO, createdAtISO: atISO, updatedAtISO: atISO, createdByUserId: staff.owner.id, createdByEmail: staff.owner.email, createdByRole: 'admin', ...DEMO_FLAG })
  }

  const messageDefs = [
    { daysAgo: 30, name: 'Arnel Bautista', email: `arnel.bautista@${DEMO_EMAIL_DOMAIN}`, message: 'Good day! Can we book the whole field for a company team building of 25 people on a weekday?', reply: 'Hi Arnel! Yes, weekdays are for private games. For 25 players we open two grounds. Book on the Reservations page or call us to plan the layout.' },
    { daysAgo: 12, name: 'Mae Santiago', email: `mae.santiago@${DEMO_EMAIL_DOMAIN}`, message: 'Is there an age limit? My son is 12 and wants to try airsoft.', reply: 'Hi Mae! Players 7 and up can play with a parent or guardian on the booking. Add your son as a minor on your account and sign his waiver there.' },
    { daysAgo: 1, name: 'Paul Ignacio', email: `paul.ignacio@${DEMO_EMAIL_DOMAIN}`, message: 'Do you sell BBs and green gas at the field, or only rent?' },
    { daysAgo: 0.2, name: 'Kristine Lopez', email: `kristine.lopez@${DEMO_EMAIL_DOMAIN}`, message: 'Hello, do you accept walk-ins this Saturday? We have our own gear.' },
  ]
  for (const m of messageDefs) {
    const atMs = now - m.daysAgo * DAY
    const replied = Boolean(m.reply)
    const replyISO = new Date(atMs + 3 * HOUR).toISOString()
    messages.push({
      id: `MSG-${Math.floor(atMs).toString(36).toUpperCase()}DEMO`, name: m.name, email: m.email, message: m.message,
      status: replied ? 'replied' : 'new', emailStatus: 'sent', createdAtISO: new Date(atMs).toISOString(),
      ...(replied ? { updatedAtISO: replyISO, updatedBy: { id: String(staff.registrar.id), role: 'registrar' }, replies: [{ body: m.reply, byId: String(staff.registrar.id), byEmail: staff.registrar.email, atISO: replyISO }] } : {}),
      ...DEMO_FLAG,
    })
  }

  const notify = (n) => notifications.push({ id: nextN(), read: false, ...n, ...DEMO_FLAG })
  const ago = (h) => new Date(now - h * HOUR).toISOString()
  // Every announcement posted on the dashboards also went to everyone's notifications (as the
  // server does when an admin posts one; see routes/crud.js).
  for (const post of posts) {
    notify({ userId: 'broadcast', targetRole: 'all', type: 'announcement', fromAdmin: true, title: 'New announcement', message: post.message, linkedResourceId: post.id, read: Date.parse(post.postedAtISO) < now - 10 * DAY, createdAtISO: post.postedAtISO })
  }
  // An admin notice just for the marshals.
  notify({ userId: 'broadcast', targetRole: 'marshal', type: 'announcement', fromAdmin: true, title: 'Chronograph every gun, every game', message: 'Reminder: every rental and player-owned gun must pass the FPS check before the game starts. Log each reading on the Safety page.', createdAtISO: ago(30) })

  const upcoming = reservations.filter((r) => !r.walkIn && r.reservationDate >= todayISO).sort((a, b) => a.reservationDate.localeCompare(b.reservationDate))
  for (const r of upcoming.filter((x) => x.reservationStatus === 'confirmed').slice(0, 8)) {
    notify({ userId: r.userId, type: 'reservation_confirmed', title: 'Booking confirmed', message: `Your game on ${r.reservationDate} (${r.reservationTime}) at ${r.locationName} is confirmed.`, linkedResourceId: r.id, read: rng.chance(0.5), createdAtISO: r.autoConfirmedAtISO || r.createdAtISO })
    const game = gameplay.find((g) => g.reservationId === r.id)
    if (game) {
      for (const role of ['marshal', 'admin']) notify({ userId: 'broadcast', targetRole: role, type: 'gameplay_created', title: 'Game confirmed: on the games board', message: `${game.Package} on ${game.Schedule} at ${game.Location}, ${r.numberOfPlayers} players.`, linkedResourceId: game.id, read: rng.chance(0.4), createdAtISO: game.createdAtISO })
    }
  }
  const splitPending = upcoming.find((r) => r.reservationStatus === 'pending' && r.paymentMode === 'split')
  if (splitPending) {
    const invite = (splitPending.invites || []).find((i) => i.status === 'pending')
    if (invite) notify({ userId: invite.playerId, type: 'team_invite', title: `${splitPending.bookerName} invited you to a game`, message: `Accept or decline the game on ${splitPending.reservationDate} (${splitPending.reservationTime}) in My Reservations.`, linkedResourceId: splitPending.id, createdAtISO: splitPending.createdAtISO })
    const paidIds = new Set(payments.filter((p) => p.reservationId === splitPending.id).map((p) => p.userId))
    for (const id of splitPending.splitPayerIds.filter((x) => !paidIds.has(x) && x !== invite?.playerId)) {
      notify({ userId: id, type: 'split_payment_updated', title: 'Pay your share', message: `Your team is waiting on your share for ${splitPending.reservationDate} (${splitPending.reservationTime}).`, linkedResourceId: splitPending.id, createdAtISO: ago(2) })
    }
  }
  const review = upcoming.find((r) => r.forwardedToAdminAtISO && r.reservationStatus === 'pending')
  if (review) {
    for (const role of ['registrar', 'admin']) notify({ userId: 'broadcast', targetRole: role, type: 'reservation_payment_finalized', title: 'Reservation fully paid: payment needs verifying', message: `All payments for ${review.reservationDate} (${review.reservationTime}) are in. Verify them on Payments; the booking is confirmed as soon as they are.`, linkedResourceId: review.id, createdAtISO: review.forwardedToAdminAtISO })
  }
  const guardianWait = upcoming.find((r) => r.guardianApproval?.status === 'pending')
  if (guardianWait) notify({ userId: guardianWait.userId, type: 'reservation_payment_finalized', title: 'Payment received: waiting for guardian approval', message: `Your payment for ${guardianWait.reservationDate} (${guardianWait.reservationTime}) is verified. The booking is confirmed as soon as every guardian approves it.`, linkedResourceId: guardianWait.id, createdAtISO: ago(26) })
  const sentBack = upcoming.find((r) => r.sentBack)
  if (sentBack) notify({ userId: sentBack.userId, type: 'reservation_status_update', title: 'Staff sent your booking back', message: sentBack.sentBack.note, linkedResourceId: sentBack.id, createdAtISO: sentBack.sentBack.atISO })
  // The front desk's own notices, worded as the server sends them (utils/paymentProgress.js,
  // routes/crud.js, routes/uploads.js), each with the admins' copy.
  const toDesk = (n) => { for (const role of ['registrar', 'admin']) notify({ userId: 'broadcast', targetRole: role, ...n }) }
  const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
  // Balances to collect at the counter, for games confirmed in the last week.
  const onsite = reservations
    .filter((r) => !r.walkIn && r.reservationStatus === 'confirmed' && r.reservationDate >= todayISO && r.onsiteNoticeSentAtISO && Date.parse(r.onsiteNoticeSentAtISO) > now - 7 * DAY)
    .sort((a, b) => a.onsiteNoticeSentAtISO.localeCompare(b.onsiteNoticeSentAtISO))
    .slice(-5)
  for (const r of onsite) {
    const due = Math.round(Math.max(0, r.totalAmount - r.depositAmount) * 100) / 100
    toDesk({
      topic: 'payment', type: 'onsite_payment_due', title: `${peso(due)} to collect onsite for ${r.id}`,
      message: `${r.bookerName || 'The player who booked'}'s booking for ${r.reservationDate} (${r.reservationTime}) is confirmed with ${peso(due)} to pay at the counter (the remaining 50%). Collect it before the game starts.`,
      linkedResourceId: r.id, read: Date.parse(r.onsiteNoticeSentAtISO) < now - 3 * DAY, createdAtISO: r.onsiteNoticeSentAtISO,
    })
  }
  // A minor's waiver signed by the parent, waiting for review.
  for (const w of people.waivers.filter((x) => x.status === 'pending')) {
    toDesk({ topic: 'waiver', type: 'waiver_submitted', title: 'New Waiver Submitted', message: `A new waiver was submitted by ${w.fullName}.`, linkedResourceId: w.id, createdAtISO: w.submittedAtISO })
  }
  // A player's ID waiting to be verified.
  for (const a of people.accounts.filter((x) => x.identityVerificationStatus === 'pending_review')) {
    toDesk({ topic: 'identity', type: 'player_id_submitted', title: 'ID to Verify', message: `${a.name} submitted their ${a.identityIdType} for verification.`, linkedResourceId: a.id, createdAtISO: a.identityVerificationUpdatedAt })
  }
  const damaged = reservations.find((r) => (r.damageCharges || []).length)
  if (damaged) notify({ userId: damaged.userId, type: 'reservation_damage_charge', title: 'Repair charge added to your booking', message: `₱${damaged.damageCharges[0].amount.toLocaleString()} for ${damaged.damageCharges[0].itemName}.`, linkedResourceId: damaged.id, read: true, createdAtISO: damaged.damageCharges[0].atISO })

  // Weather: one past rain advisory that went out to players.
  const rainy = reservations.filter((r) => !r.walkIn && r.reservationStatus === 'confirmed' && r.reservationDate < todayISO && r.reservationDate > addDays(todayISO, -50))[0]
  if (rainy) {
    const at = new Date(atManila(addDays(rainy.reservationDate, -1), '09:00')).toISOString()
    const recipients = 1 + (rainy.teamMembers || []).length
    advisories.push({
      id: `WX-${rainy.id.slice(2)}`, source: 'auto', locationId: rainy.locationId, date: rainy.reservationDate, slot: rainy.reservationTime,
      title: 'Weather advisory for your game tomorrow', message: `The forecast for ${rainy.locationName} tomorrow (${rainy.reservationTime}) shows rain likely. Games go on in light rain; bring a change of clothes.`,
      forecast: { date: rainy.reservationDate, slot: rainy.reservationTime, available: true, severe: false, rainy: true, reasons: ['rain likely (70% chance)'], rainChancePercent: 70, rainMm: 1.4, windKph: 18, tempC: 29, summary: 'light rain; 70% chance of rain, up to 29°C' },
      reservationCount: 1, recipientCount: recipients, createdAtISO: at, createdBy: null, ...DEMO_FLAG,
    })
    notify({ userId: rainy.userId, type: 'weather_advisory', title: 'Weather advisory for your game tomorrow', message: advisories[0].message, linkedResourceId: rainy.id, read: true, createdAtISO: at })
  }
  return { posts, messages, notifications, advisories }
}

export function staffAuditLogs({ people, staff, now }) {
  const logs = []
  const tomas = people.accounts.find((a) => a.status === 'suspended')
  if (tomas) {
    logs.push({ action: 'player_suspended', resourceType: 'user_accounts', resourceId: tomas.id, actorId: String(staff.admin.id), actorRole: 'admin', details: { reason: tomas.suspensionReason, playerName: tomas.name, playerEmail: tomas.email }, createdAtISO: tomas.suspendedAtISO, ...DEMO_FLAG })
  }
  void now
  return logs
}
