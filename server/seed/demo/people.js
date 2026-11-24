// Demo people: staff, players (with verified IDs, CvSU discount requests and different account
// states), children on their parents' accounts, and everyone's waivers.

import bcrypt from 'bcrypt'
import { canonicalEmail } from '../../utils/emails.js'
import { composeFullName } from '../../utils/names.js'
import { validUntilFrom } from '../../utils/waiverValidity.js'
import { CVSU_NAME } from '../../utils/bookingPricing.js'
import {
  DAY, DEMO_EMAIL_DOMAIN, DEMO_FLAG, DEMO_PASSWORD, addDays, ageOn, idCardSvg, isoAt, manilaDay, signatureDataUri,
} from './lib.js'

// New staff (the admin, registrar and marshal accounts already in the database are kept as-is).
const NEW_STAFF = [
  { key: 'owner', id: '4', role: 'admin', firstName: 'Ricardo', middleInitial: 'S', lastName: 'Villanueva', title: 'Owner / Manager' },
  { key: 'registrar2', id: '5', role: 'registrar', firstName: 'Liza', middleInitial: 'M', lastName: 'Manalo', title: 'Front desk' },
  { key: 'marshal2', id: '6', role: 'marshal', firstName: 'Jomar', middleInitial: 'T', lastName: 'Bautista', title: 'Head marshal' },
  { key: 'marshal3', id: '7', role: 'marshal', firstName: 'Kevin', middleInitial: 'A', lastName: 'Soriano', title: 'Field marshal' },
]

const ID_TYPES = ['PhilSys National ID', "LTO Driver's License", 'UMID', 'Philippine Passport', 'Postal ID', 'SSS ID']

// joinedDaysAgo: when the account was made. gamesBefore: games played before the system existed
// (experienceAdjustment). Special states are noted per player.
const PLAYERS = [
  { key: 'juan', firstName: 'Juan', middleInitial: 'P', lastName: 'Dela Cruz', nickname: 'JDC', birthDate: '1996-03-14', joinedDaysAgo: 220, gamesBefore: 14 },
  { key: 'marco', firstName: 'Marco', middleInitial: 'R', lastName: 'Santos', nickname: 'Bravo', birthDate: '1994-07-22', joinedDaysAgo: 205, gamesBefore: 20 },
  { key: 'andrea', firstName: 'Andrea', middleInitial: 'L', lastName: 'Reyes', birthDate: '1998-11-05', joinedDaysAgo: 190, gamesBefore: 4 },
  { key: 'paolo', firstName: 'Paolo', middleInitial: 'C', lastName: 'Garcia', nickname: 'Pao', birthDate: '1992-02-18', joinedDaysAgo: 200, gamesBefore: 30, ownGun: { name: 'Tokyo Marui M4A1 MWS', category: 'rifles' } },
  { key: 'bea', firstName: 'Bea', middleInitial: 'M', lastName: 'Navarro', birthDate: '2000-09-30', joinedDaysAgo: 160, gamesBefore: 2 },
  { key: 'carlo', firstName: 'Carlo', middleInitial: 'D', lastName: 'Mendoza', birthDate: '1997-05-11', joinedDaysAgo: 150, gamesBefore: 6 },
  { key: 'rafael', firstName: 'Rafael', middleInitial: 'T', lastName: 'Aquino', nickname: 'Raf', birthDate: '1990-12-02', joinedDaysAgo: 210, gamesBefore: 25, ownGun: { name: 'Glock 17 GBB Pistol', category: 'pistols' } },
  { key: 'kyla', firstName: 'Kyla', middleInitial: 'S', lastName: 'Ramos', birthDate: '2001-04-27', joinedDaysAgo: 140, gamesBefore: 0 },
  { key: 'joshua', firstName: 'Joshua', middleInitial: 'A', lastName: 'Flores', birthDate: '1999-08-19', joinedDaysAgo: 175, gamesBefore: 8 },
  { key: 'patricia', firstName: 'Patricia', middleInitial: 'G', lastName: 'Lim', birthDate: '1995-01-09', joinedDaysAgo: 130, gamesBefore: 3 },
  { key: 'nathaniel', firstName: 'Nathaniel', middleInitial: 'B', lastName: 'Cruz', nickname: 'Nate', birthDate: '1993-06-25', joinedDaysAgo: 185, gamesBefore: 12 },
  { key: 'erika', firstName: 'Erika', middleInitial: 'V', lastName: 'Domingo', birthDate: '2002-10-14', joinedDaysAgo: 120, gamesBefore: 0 },
  { key: 'vincent', firstName: 'Vincent', middleInitial: 'J', lastName: 'Tan', birthDate: '1985-03-03', joinedDaysAgo: 170, gamesBefore: 5 },
  { key: 'grace', firstName: 'Grace', middleInitial: 'P', lastName: 'Torres', birthDate: '1988-09-17', joinedDaysAgo: 110, gamesBefore: 1 },
  { key: 'dennis', firstName: 'Dennis', middleInitial: 'R', lastName: 'Castillo', birthDate: '1984-11-28', joinedDaysAgo: 45, gamesBefore: 0 },
  { key: 'aaron', firstName: 'Aaron', middleInitial: 'K', lastName: 'Pascual', birthDate: '1998-02-07', joinedDaysAgo: 165, gamesBefore: 9 },
  { key: 'camille', firstName: 'Camille', middleInitial: 'D', lastName: 'Rivera', birthDate: '1997-12-21', joinedDaysAgo: 135, gamesBefore: 2 },
  { key: 'jerome', firstName: 'Jerome', middleInitial: 'F', lastName: 'Salazar', birthDate: '1996-04-04', joinedDaysAgo: 125, gamesBefore: 7, ownGun: { name: 'Novritsch SSG10 A1 (sniper)', category: 'snipers' } },
  { key: 'ivan', firstName: 'Ivan', middleInitial: 'M', lastName: 'Gonzales', birthDate: '2000-06-16', joinedDaysAgo: 100, gamesBefore: 0 },
  { key: 'rhea', firstName: 'Rhea', middleInitial: 'C', lastName: 'Morales', birthDate: '1999-03-29', joinedDaysAgo: 95, gamesBefore: 1 },
  { key: 'gabriel', firstName: 'Gabriel', middleInitial: 'S', lastName: 'Mercado', birthDate: '1994-09-09', joinedDaysAgo: 180, gamesBefore: 10 },
  { key: 'hannah', firstName: 'Hannah', middleInitial: 'L', lastName: 'Robles', birthDate: '2000-02-14', joinedDaysAgo: 80, gamesBefore: 0 },
  // Cavite State University students (CvSU partnership discount).
  { key: 'miguel', firstName: 'Miguel', middleInitial: 'A', lastName: 'Ocampo', birthDate: '2004-05-12', joinedDaysAgo: 115, gamesBefore: 0, cvsu: 'verified' },
  { key: 'alyssa', firstName: 'Alyssa', middleInitial: 'J', lastName: 'Dizon', birthDate: '2005-01-23', joinedDaysAgo: 112, gamesBefore: 0, cvsu: 'verified' },
  { key: 'renz', firstName: 'Renz', middleInitial: 'P', lastName: 'Manalastas', birthDate: '2004-08-08', joinedDaysAgo: 105, gamesBefore: 1, cvsu: 'verified' },
  { key: 'trisha', firstName: 'Trisha', middleInitial: 'N', lastName: 'Galang', birthDate: '2005-10-02', joinedDaysAgo: 90, gamesBefore: 0, cvsu: 'verified' },
  { key: 'kenneth', firstName: 'Kenneth', middleInitial: 'L', lastName: 'Sison', birthDate: '2003-12-15', joinedDaysAgo: 88, gamesBefore: 2, cvsu: 'verified' },
  { key: 'jasmine', firstName: 'Jasmine', middleInitial: 'R', lastName: 'Velasco', birthDate: '2005-07-07', joinedDaysAgo: 20, gamesBefore: 0, cvsu: 'pending' },
  { key: 'lance', firstName: 'Lance', middleInitial: 'E', lastName: 'Bernardo', birthDate: '2004-02-26', joinedDaysAgo: 30, gamesBefore: 0, cvsu: 'rejected' },
  // Account states to review.
  { key: 'nicole', firstName: 'Nicole', middleInitial: 'F', lastName: 'Aguilar', birthDate: '1996-10-26', joinedDaysAgo: 12, gamesBefore: 0 },
  { key: 'sean', firstName: 'Sean', middleInitial: 'T', lastName: 'Fernandez', birthDate: '1995-08-30', joinedDaysAgo: 2, gamesBefore: 0, identity: 'pending_review' },
  { key: 'ella', firstName: 'Ella', middleInitial: 'M', lastName: 'Javier', birthDate: '2001-11-11', joinedDaysAgo: 6, gamesBefore: 0, identity: 'rejected' },
  { key: 'louie', firstName: 'Louie', middleInitial: 'G', lastName: 'Panganiban', birthDate: '1993-01-19', joinedDaysAgo: 400, gamesBefore: 18, identity: 'expired' },
  { key: 'tomas', firstName: 'Tomas', middleInitial: 'B', lastName: 'Herrera', birthDate: '1989-05-05', joinedDaysAgo: 190, gamesBefore: 3, suspended: true },
]

// Minors on their parent's account.
const CHILDREN = [
  { key: 'lucas', firstName: 'Lucas', middleInitial: 'V', lastName: 'Tan', birthDate: '2013-04-10', guardian: 'vincent', waiver: 'approved' },
  { key: 'mia', firstName: 'Mia', middleInitial: 'V', lastName: 'Tan', birthDate: '2014-03-30', guardian: 'vincent', waiver: 'approved' },
  { key: 'ethan', firstName: 'Ethan', middleInitial: 'P', lastName: 'Torres', birthDate: '2011-06-02', guardian: 'grace', waiver: 'approved' },
  { key: 'sofia', firstName: 'Sofia', middleInitial: 'R', lastName: 'Castillo', birthDate: '2013-09-19', guardian: 'dennis', waiver: 'pending' },
]

function emailOf(firstName, lastName) {
  const local = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, '')
  return `${local}@${DEMO_EMAIL_DOMAIN}`
}

export async function buildPeople({ now, todayISO, rng, files, keptStaff, waiverText }) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
  const accounts = []
  const waivers = []
  const byKey = new Map()

  // --- staff ---------------------------------------------------------------
  const staff = {
    admin: keptStaff.find((s) => s.role === 'admin'),
    registrar: keptStaff.find((s) => s.role === 'registrar'),
    marshal: keptStaff.find((s) => s.role === 'marshal'),
  }
  for (const s of NEW_STAFF) {
    const name = composeFullName(s)
    const email = emailOf(s.firstName, s.lastName)
    const joined = new Date(now - 230 * DAY).toISOString()
    const doc = {
      id: s.id,
      role: s.role,
      name,
      firstName: s.firstName,
      middleInitial: s.middleInitial,
      lastName: s.lastName,
      email,
      emailCanonical: canonicalEmail(email),
      authProvider: '',
      password: passwordHash,
      experience: 0,
      emailVerified: true,
      identityVerificationStatus: 'not_submitted',
      status: 'Active',
      jobTitle: s.title,
      createdAtISO: joined,
      lastLoginAtISO: new Date(now - rng.int(2, 40) * 3600_000).toISOString(),
      ...DEMO_FLAG,
    }
    accounts.push(doc)
    staff[s.key] = doc
  }

  // --- adult players ---------------------------------------------------------
  let nextNumber = 101
  for (const p of PLAYERS) {
    const id = `P-${String(nextNumber).padStart(6, '0')}`
    nextNumber += 1
    const name = composeFullName(p)
    const email = emailOf(p.firstName, p.lastName)
    const joinedMs = now - p.joinedDaysAgo * DAY - rng.int(1, 10) * 3600_000
    const joinedISO = new Date(joinedMs).toISOString()
    const idType = ID_TYPES[(nextNumber + p.lastName.length) % ID_TYPES.length]
    const idNumber = `${String(1000 + (nextNumber * 37) % 9000)}-${String(1000 + (nextNumber * 91) % 9000)}-${String(100000 + (nextNumber * 7919) % 900000)}`
    const identity = p.identity || 'verified'
    const submittedISO = new Date(joinedMs + 2 * 3600_000).toISOString()
    const front = files.add({ key: `id-front-${p.key}`, filename: `${p.lastName.toLowerCase()}-id-front.svg`, svg: idCardSvg({ name, idType, idNumber, birthDate: p.birthDate }), uploadedBy: id, isPrivate: true, createdAtISO: submittedISO })
    const back = files.add({ key: `id-back-${p.key}`, filename: `${p.lastName.toLowerCase()}-id-back.svg`, svg: idCardSvg({ name, idType, idNumber, side: 'back' }), uploadedBy: id, isPrivate: true, createdAtISO: submittedISO })
    const reviewer = staff.registrar
    const verifiedISO = new Date(joinedMs + 20 * 3600_000).toISOString()

    const doc = {
      id,
      role: 'user',
      name,
      firstName: p.firstName,
      middleInitial: p.middleInitial,
      lastName: p.lastName,
      ...(p.nickname ? { nickname: p.nickname } : {}),
      email,
      emailCanonical: canonicalEmail(email),
      password: passwordHash,
      birthDate: p.birthDate,
      age: ageOn(p.birthDate, todayISO),
      experience: 0,
      experienceAdjustment: p.gamesBefore,
      emailVerified: true,
      status: p.suspended ? 'suspended' : 'Active',
      identityIdType: idType,
      identityDocumentUrl: front,
      identityDocumentBackUrl: back,
      identityScanStatus: 'done',
      identityVerificationUpdatedAt: identity === 'verified' || identity === 'expired' ? verifiedISO : submittedISO,
      identityVerificationStatus: identity,
      createdAtISO: joinedISO,
      lastLoginAtISO: new Date(now - rng.int(3, 24 * 20) * 3600_000).toISOString(),
      ...DEMO_FLAG,
    }
    if (identity === 'verified' || identity === 'expired') {
      Object.assign(doc, {
        identityVerifiedAtISO: verifiedISO,
        identityValidUntilISO: validUntilFrom(verifiedISO),
        identityReviewedBy: { id: String(reviewer.id), role: reviewer.role },
      })
    }
    if (identity === 'rejected') {
      doc.identityReviewReason = 'The ID photo is blurry and the name cannot be read. Please upload a clearer photo.'
      doc.identityReviewedBy = { id: String(reviewer.id), role: reviewer.role }
    }
    if (p.suspended) {
      const at = new Date(now - 40 * DAY).toISOString()
      doc.suspendedAtISO = at
      doc.suspensionReason = 'Repeated blind firing and ignoring marshal calls (warned twice).'
      doc.statusHistory = [{ status: 'suspended', reason: doc.suspensionReason, actorId: String(staff.admin.id), atISO: at }]
    }
    if (p.cvsu) {
      const proofISO = new Date(joinedMs + 5 * 3600_000).toISOString()
      const proof = files.add({ key: `cvsu-${p.key}`, filename: `${p.lastName.toLowerCase()}-cvsu-id.svg`, svg: idCardSvg({ name, idType: 'CvSU Student ID', idNumber: `20${p.birthDate.slice(2, 4)}-${String(10000 + nextNumber * 13).slice(0, 5)}`, birthDate: p.birthDate }), uploadedBy: id, createdAtISO: proofISO })
      const history = [{ status: 'pending', institution: CVSU_NAME, atISO: proofISO, actorId: id, actorRole: 'user' }]
      Object.assign(doc, {
        partnershipInstitution: CVSU_NAME,
        partnershipProofUrl: proof,
        partnershipEligibilityStatus: p.cvsu,
        partnershipRequestedAtISO: proofISO,
      })
      if (p.cvsu !== 'pending') {
        const reviewedISO = new Date(joinedMs + 26 * 3600_000).toISOString()
        const reason = p.cvsu === 'rejected' ? 'The student ID shown is from AY 2023–2024. Upload your current CvSU ID or registration form.' : ''
        Object.assign(doc, {
          partnershipReviewReason: reason,
          partnershipReviewedAtISO: reviewedISO,
          partnershipReviewedBy: { actorId: String(reviewer.id), actorEmail: reviewer.email, actorRole: reviewer.role },
        })
        history.push({ status: p.cvsu, reason, atISO: reviewedISO, actorId: String(reviewer.id), actorEmail: reviewer.email, actorRole: reviewer.role })
      }
      doc.partnershipHistory = history
    }
    if (identity === 'expired') {
      doc.identityPreviousValidUntilISO = undefined
      delete doc.identityPreviousValidUntilISO
    }
    accounts.push(doc)
    byKey.set(p.key, { ...p, account: doc })

    // The player's own waiver: signed once the ID is verified (auto-approved, as in routes/crud.js).
    if (identity === 'verified' || identity === 'expired') {
      const approvedISO = new Date(joinedMs + 22 * 3600_000).toISOString()
      const validUntilISO = validUntilFrom(approvedISO)
      const expired = Date.parse(validUntilISO) <= now
      waivers.push({
        id: `WAIV-${Date.parse(approvedISO)}`,
        userId: id,
        fullName: name,
        email,
        birthDate: p.birthDate,
        age: ageOn(p.birthDate, manilaDay(Date.parse(approvedISO))),
        guardianName: '',
        guardianConsent: false,
        consent: true,
        termsAccepted: true,
        isMinor: false,
        hasSignature: true,
        signatureImage: signatureDataUri(name, rng),
        signatureMethod: 'drawn',
        guardianEmail: '',
        guardianIdImage: '',
        guardianIdType: '',
        guardianSignatureImage: '',
        status: expired ? 'expired' : 'approved',
        ...(expired ? { expiredAtISO: validUntilISO } : {}),
        submittedAtISO: approvedISO,
        createdAtISO: approvedISO,
        idType,
        idImage: front,
        idImageBack: back,
        idChecked: true,
        autoApproved: true,
        approvedAtISO: approvedISO,
        reviewedAtISO: approvedISO,
        validUntilISO,
        reviewedBy: { id: 'system', role: 'system', name: 'Identity verification' },
        reviewerNote: 'Approved automatically: the ID was verified on the player profile.',
        ...(waiverText ? { waiverText } : {}),
        ...DEMO_FLAG,
      })
    }
  }

  // Player-registered guns (the "bring your own" weapons on a player's profile).
  const ownWeapons = []
  for (const p of PLAYERS.filter((x) => x.ownGun)) {
    const account = byKey.get(p.key).account
    const createdISO = new Date(Date.parse(account.createdAtISO) + 3 * DAY).toISOString()
    ownWeapons.push({
      id: `W-PLAYER-${Date.parse(createdISO)}`,
      kind: 'weapon',
      name: p.ownGun.name,
      category: p.ownGun.category,
      status: 'available',
      description: 'Player-owned. Chronographed before every game.',
      note: '',
      createdAtISO: createdISO,
      submittedBy: account.id,
      source: 'player',
      approvalStatus: 'approved',
      ...DEMO_FLAG,
    })
  }

  // --- children ----------------------------------------------------------------
  for (const c of CHILDREN) {
    const id = `P-${String(nextNumber).padStart(6, '0')}`
    nextNumber += 1
    const parent = byKey.get(c.guardian).account
    const name = composeFullName(c)
    const addedMs = Date.parse(parent.createdAtISO) + 4 * DAY
    const addedISO = new Date(addedMs).toISOString()
    const child = {
      id,
      role: 'user',
      name,
      firstName: c.firstName,
      lastName: c.lastName,
      middleInitial: c.middleInitial,
      birthDate: c.birthDate,
      age: ageOn(c.birthDate, todayISO),
      isMinor: true,
      isChildProfile: true,
      guardianId: parent.id,
      guardianName: parent.name,
      guardianConfirmedAtISO: addedISO,
      status: 'Active',
      createdAtISO: addedISO,
      ...DEMO_FLAG,
    }
    accounts.push(child)
    byKey.set(c.key, { ...c, account: child, isChild: true })

    // The parent signs the minor waiver; staff check the child's ID before approving.
    const parentWaiver = waivers.find((w) => w.userId === parent.id && w.status === 'approved')
    const submittedISO = c.waiver === 'pending' ? new Date(now - 26 * 3600_000).toISOString() : addedISO
    const childId = files.add({ key: `child-id-${c.key}`, filename: `${c.lastName.toLowerCase()}-${c.firstName.toLowerCase()}-school-id.svg`, svg: idCardSvg({ name, idType: 'School ID', idNumber: `S-${String(id).slice(-4)}-${c.birthDate.slice(0, 4)}`, birthDate: c.birthDate }), uploadedBy: parent.id, isPrivate: true, createdAtISO: submittedISO })
    const reviewedISO = new Date(Date.parse(submittedISO) + 5 * 3600_000).toISOString()
    waivers.push({
      id: `WAIV-${Date.parse(submittedISO) + 7}`,
      userId: id,
      forChild: true,
      guardianId: parent.id,
      submittedBy: parent.id,
      fullName: name,
      email: parent.email,
      birthDate: c.birthDate,
      age: ageOn(c.birthDate, manilaDay(Date.parse(submittedISO))),
      isMinor: true,
      consent: true,
      termsAccepted: true,
      guardianConsent: true,
      hasSignature: true,
      signatureImage: parentWaiver?.signatureImage || signatureDataUri(parent.name, rng),
      signatureMethod: 'drawn',
      idType: 'Valid ID or school ID',
      idImage: childId,
      guardianName: parent.name,
      guardianEmail: parent.email,
      guardianIdType: parent.identityIdType,
      guardianIdImage: parent.identityDocumentUrl,
      guardianIdImageBack: parent.identityDocumentBackUrl,
      guardianSignatureImage: parentWaiver?.signatureImage || '',
      guardianFromAccount: true,
      guardianIdVerifiedOnProfile: true,
      guardianIdChecked: true,
      status: c.waiver,
      submittedAtISO: submittedISO,
      createdAtISO: submittedISO,
      ...(c.waiver === 'approved' ? {
        idChecked: true,
        approvedAtISO: reviewedISO,
        reviewedAtISO: reviewedISO,
        validUntilISO: validUntilFrom(reviewedISO),
        reviewedBy: { id: String(staff.registrar.id), role: 'registrar', name: staff.registrar.name },
        reviewerNote: 'Checked the school ID and the parent\'s verified ID.',
      } : {}),
      ...(waiverText ? { waiverText } : {}),
      ...DEMO_FLAG,
    })
  }

  const player = (key) => {
    const entry = byKey.get(key)
    if (!entry) throw new Error(`Unknown demo player ${key}`)
    return entry.account
  }
  return { accounts, waivers, staff, byKey, player, ownWeapons, passwordHash }
}

// Whether a player can be booked on a date: an approved waiver covering it (adults) or, for a
// child, an approved minor waiver. Used so no booking breaks the waiver rule.
export function waiverCovers(waivers, userId, dateISO) {
  return waivers.some((w) => w.userId === userId
    && ['approved', 'expired'].includes(w.status)
    && w.approvedAtISO
    && manilaDay(Date.parse(w.approvedAtISO)) <= dateISO
    && manilaDay(Date.parse(w.validUntilISO)) > dateISO)
}

export { addDays, isoAt }
