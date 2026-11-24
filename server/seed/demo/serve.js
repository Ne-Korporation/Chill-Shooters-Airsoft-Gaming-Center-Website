// Starts the API on the demo database (chillshooters_demo) instead of the production one.
// Same server as `npm run server`; only the database name changes.
//
//   npm run demo:server              API on http://localhost:3001 using chillshooters_demo
//   npm run demo:server -- --no-email   …and send no emails at all
//
// Demo accounts use @demo.chillshooters.test addresses (a reserved domain), so emails the app
// sends to them never reach a real inbox. --no-email turns sending off completely (sign-up codes
// for brand-new accounts then can't be sent either).

process.env.DB_NAME = process.env.DEMO_DB_NAME || 'chillshooters_demo'
if (process.argv.includes('--no-email')) {
  // Set before server/.env is loaded: dotenv leaves variables that already exist alone.
  process.env.BREVO_API_KEY = ''
  process.env.EMAIL_USER = ''
  process.env.EMAIL_PASS = ''
}
console.log(`Demo API: using database "${process.env.DB_NAME}"`)
await import('../../index.js')
