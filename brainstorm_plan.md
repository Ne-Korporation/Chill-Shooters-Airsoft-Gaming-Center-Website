# Brainstorm plan: FIX THE LIGHT MODE

## Information gathered
- `ThemeContext` sets `document.documentElement` attribute `data-theme` to `light`/`dark` and stores it in `localStorage`.
- `src/styles/theme.css` defines CSS variables per theme and styles `.glass`, `.bg-background`, `.text-text`, `.text-muted`.
- Tailwind colors in `tailwind.config.js` are currently hardcoded hex values (e.g. `background: '#121212'`, `text: '#F5F5F5'`, etc.).
- Many components use Tailwind classes like `bg-primary`, `text-background`, `bg-white/5`, etc., which do not automatically change with `data-theme`.

## Plan (code changes)
1. Update `tailwind.config.js` to bind Tailwind color tokens to the CSS variables from `src/styles/theme.css`.
   - Example: `background` should map to `rgb(var(--bg))` instead of `#121212`.
   - Similarly map `text`, `muted`, `card`, `border`, `accent`, `success`, `danger`, and primary/secondary.
2. Keep `.glass` behavior in `src/styles/theme.css` as-is.
3. Build + run dev to verify the light theme toggle actually changes page backgrounds/text.

## Dependent files to edit
- `tailwind.config.js`
- (optional) `src/styles/theme.css` if we discover missing variables needed by the Tailwind mapping.

## Followup steps
- Run `npm run build`.
- Manually switch theme using `ThemeToggle` and confirm: Landing/Login pages + one dashboard page have correct light backgrounds/typography.

