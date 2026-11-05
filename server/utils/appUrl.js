// The website's address, used for links in emails (booking, payment, guardian approval, reminders).
//
// Set PUBLIC_APP_URL to the deployed site (for example https://your-site.vercel.app). Without it,
// a link falls back to the site the request came from (the browser's Origin header), then to the
// last site seen calling this API (for background emails such as reminders, which have no
// request), and only then to the local dev address, which works on this computer only.
const LOCAL_DEV_URL = 'http://localhost:5173'
let lastSeenOrigin = ''

function cleanOrigin(value) {
  const origin = String(value || '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[^\s/]+$/.test(origin) ? origin : ''
}

export function configuredAppUrl() {
  return String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
}

// Express middleware: remembers the site calling the API, for emails sent without a request.
export function rememberAppOrigin(req, _res, next) {
  const origin = cleanOrigin(req.get?.('origin'))
  if (origin) lastSeenOrigin = origin
  next()
}

export function publicAppUrl(req) {
  return configuredAppUrl() || cleanOrigin(req?.get?.('origin')) || lastSeenOrigin || LOCAL_DEV_URL
}
