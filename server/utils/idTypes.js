// Philippine IDs a player can submit for identity verification, and which sides the photos must
// show. Mirrors IDENTITY_ID_TYPES in src/utils/idTypes.ts.
export const IDENTITY_ID_TYPES = [
  { name: 'Philippine Passport', sides: 'front' },
  { name: 'ePhilID (printed)', sides: 'front' },
  { name: 'UMID', sides: 'front' },
  { name: 'PhilSys National ID', sides: 'front_back' },
  { name: "LTO Driver's License", sides: 'front_back' },
  { name: 'PRC ID', sides: 'front_back' },
  { name: 'Postal ID', sides: 'front_back' },
  { name: 'SSS ID', sides: 'front_back' },
  { name: 'Pag-IBIG Loyalty Card Plus', sides: 'front_back' },
]

export function findIdentityIdType(name) {
  return IDENTITY_ID_TYPES.find((type) => type.name === name) || null
}

// Older names still found on submitted waivers.
const LEGACY_ID_TYPES = ['Passport', "Driver's License", "Voter's ID", 'PhilHealth ID', 'Senior Citizen ID', 'School ID']

// Every ID type a waiver may carry.
export const ACCEPTED_ID_TYPES = [...IDENTITY_ID_TYPES.map((type) => type.name), ...LEGACY_ID_TYPES]
