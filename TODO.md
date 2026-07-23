# TODO: Make Rental Packages Work with Weapons & Equipment

- [x] Plan created and approved by user

## Implementation Steps - COMPLETE ✅

### AdminRentalPackagesPage.tsx ✅
- [x] API imports (apiGet, apiPost, apiPut, apiDelete) + toast
- [x] Updated RentalPackage type (weaponIds, equipmentIds instead of includedItems)
- [x] Removed tier field
- [x] Added basePrice, minPlayers fields
- [x] Fetches packages, weapons, equipment on mount via API
- [x] Multi-select checkboxes for weapons & equipment from inventory
- [x] **Prices shown from inventory** — no price inputs in rental packages
- [x] Right panel shows selected weapon/equipment details with prices from inventory
- [x] CRUD operations via API (create, save, archive, delete)
- [x] Loading/error/saving states

### AdminWeaponsPage.tsx ✅ (price already present)
- [x] `price: number` in WeaponItem type
- [x] Price input (₱) in add/edit form
- [x] Price column in table
- [x] Price sent in create/update API payloads
- [x] Price normalized from DB on fetch

### AdminEquipmentPage.tsx ✅ (price already present)
- [x] `price: number` in InventoryItem type
- [x] Price input (₱) in add/edit form
- [x] Price displayed in table
- [x] Price sent in create/update API payloads
- [x] Price normalized from DB on fetch

