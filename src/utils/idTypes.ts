// Philippine IDs a player can submit, and which sides of each the photo must show.
// Mirrors IDENTITY_ID_TYPES in server/utils/idTypes.js.
export type IdSides = 'front' | 'front_back'

export const IDENTITY_ID_TYPES: ReadonlyArray<{ name: string; sides: IdSides; note: string }> = [
  // Front only: the photo, name, birthday and ID number are all on one face.
  { name: 'Philippine Passport', sides: 'front', note: 'Data page only, with the machine-readable lines at the bottom.' },
  { name: 'ePhilID (printed)', sides: 'front', note: 'The printed page with your photo and details.' },
  { name: 'UMID', sides: 'front', note: 'Front side: photo, signature and CRN.' },
  // Front and back: the back holds a QR code, barcode or security details that are checked too.
  { name: 'PhilSys National ID', sides: 'front_back', note: 'The back has the QR code used to authenticate the card.' },
  { name: "LTO Driver's License", sides: 'front_back', note: 'The back has the barcode, restriction codes and conditions.' },
  { name: 'PRC ID', sides: 'front_back', note: 'The back has the QR code with your registration status.' },
  { name: 'Postal ID', sides: 'front_back', note: 'The back has the barcode and security text.' },
  { name: 'SSS ID', sides: 'front_back', note: 'The back has the terms and barcode.' },
  { name: 'Pag-IBIG Loyalty Card Plus', sides: 'front_back', note: 'The back has the magnetic strip and card details.' },
]

export function idTypeNeedsBack(name: string | undefined): boolean {
  return IDENTITY_ID_TYPES.find((type) => type.name === name)?.sides === 'front_back'
}

// Older names still found on submitted waivers.
const LEGACY_ID_TYPES = [
  'Passport',
  "Driver's License",
  "Voter's ID",
  'PhilHealth ID',
  'Senior Citizen ID',
  'School ID',
]

// Every ID type a waiver may carry. Mirrors ACCEPTED_ID_TYPES in server/routes/crud.js.
export const ACCEPTED_ID_TYPES: readonly string[] = [...IDENTITY_ID_TYPES.map((type) => type.name), ...LEGACY_ID_TYPES]

// The types offered when choosing an ID (a minor's guardian on a waiver uses the same list).
export const SELECTABLE_ID_TYPES: readonly string[] = IDENTITY_ID_TYPES.map((type) => type.name)
