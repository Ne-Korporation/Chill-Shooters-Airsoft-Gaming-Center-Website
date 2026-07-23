# Plan: Make Rental Packages Work with Weapons & Equipment Selection

## Information Gathered

### Current State:
1. **AdminRentalPackagesPage.tsx** - Uses local state only, hardcoded data, no API integration. Type has: `id, name, tier, discountPct, equipmentCount, status, description, includedItems: string[]`. Right panel shows simple text list of `includedItems`.
2. **AdminWeaponsPage.tsx** - Full CRUD connected to MongoDB via `/api/weapons`. Weapons have: `id, name, category, status, note, description`.
3. **AdminEquipmentPage.tsx** - Full CRUD connected to MongoDB via `/api/equipments`. Equipment have: `id, name, category, status, qty, note, description`.
4. **`packages`** is in `ALLOWED_COLLECTIONS` in the server, so CRUD routes are already available.
5. **Reservation flow** uses separate hardcoded `Package` type (different from admin rental packages).

### Changes Needed:
1. Update RentalPackage type to include `weaponIds: string[]` and `equipmentIds: string[]`
2. Add API integration to fetch/save packages from `/api/packages`
3. Fetch weapons & equipment from APIs to populate selection UI
4. Add multi-select UI for weapons and equipment in the form
5. Show selected weapons & equipment details in the right panel with names/categories
6. Keep the same UI look and feel

## Plan

### Step 1: Update the **AdminRentalPackagesPage.tsx**
- Add imports for `apiGet`, `apiPost`, `apiPut`, `apiDelete`
- Add toast import
- Update `RentalPackage` type to add `weaponIds: string[]`, `equipmentIds: string[]`, and remove `includedItems`
- Fetch packages from `/api/packages` on load
- Fetch weapons from `/api/weapons` and equipment from `/api/equipments` for selection
- Replace `form` state from simple 3-field to include selected weapons/equipment
- Add weapon/equipment multi-select UI in the editor panel
- Update the right panel to show selected weapons and equipment with their details
- Connect save/create/update/delete to backend APIs

## Files to Edit:
1. `src/pages/admin/AdminRentalPackagesPage.tsx` - Main changes

