import { initializeApp } from 'firebase/app'
import { getAuth, getRedirectResult, GoogleAuthProvider, signInWithPopup, signInWithRedirect, type User } from 'firebase/auth'

// The redirect sign-in only works in today's browsers when authDomain is the site's own domain
// (Vercel proxies /__/auth/ to Firebase, see vercel.json). Set VITE_FIREBASE_AUTH_DOMAIN to the
// site domain once its /__/auth/handler URL is an authorized redirect URI in Google Cloud.
const firebaseConfig = {
  apiKey: 'AIzaSyAWZ97DTTBq6FZSorJbn-NtzCzKCIxWf9E',
  authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'chill-shooters.firebaseapp.com'),
  projectId: 'chill-shooters',
  storageBucket: 'chill-shooters.firebasestorage.app',
  messagingSenderId: '446602893368',
  appId: '1:446602893368:web:5af96bcbdccce2fe322ecd',
  measurementId: 'G-PFXX97C12Q',
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

const REDIRECT_PENDING_KEY = 'google_redirect_pending'

// Firebase error codes are cryptic; translate the ones players actually hit.
function describeFirebaseError(err: any): string {
  const code = String(err?.code || '')
  switch (code) {
    case 'auth/unauthorized-domain':
      return `Google sign-in is not enabled for ${window.location.hostname}. An admin must add this domain under Firebase Console → Authentication → Settings → Authorized domains.`
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled.'
    case 'auth/operation-not-allowed':
      return 'Google sign-in is turned off for this project. Enable the Google provider in Firebase Console → Authentication → Sign-in method.'
    case 'auth/network-request-failed':
      return 'Could not reach Google. Check your connection and try again.'
    default:
      return err?.message || 'Google sign-in failed.'
  }
}

export type GoogleProfile = { name: string; email: string; uid: string; idToken: string }

async function toProfile(user: User): Promise<GoogleProfile> {
  return {
    name: user.displayName || '',
    email: user.email || '',
    uid: user.uid,
    // Sent to the API so it can confirm with Google that this sign-in really happened.
    idToken: await user.getIdToken(),
  }
}

// Opens the Google pop-up. When the browser blocks pop-ups (phones, in-app browsers like
// Messenger, strict settings), it falls back to a full-page redirect to Google and resolves to
// null; the page then finishes the sign-in on return with completeGoogleRedirect().
export async function signInWithGoogle(): Promise<GoogleProfile | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider)
    return await toProfile(result.user)
  } catch (err: any) {
    if (err?.code === 'auth/popup-blocked') {
      sessionStorage.setItem(REDIRECT_PENDING_KEY, '1')
      await signInWithRedirect(auth, googleProvider)
      return null
    }
    throw new Error(describeFirebaseError(err))
  }
}

// Call once when the login/register page loads: returns the Google profile if the player just
// came back from the redirect sign-in, otherwise null.
export async function completeGoogleRedirect(): Promise<GoogleProfile | null> {
  if (!sessionStorage.getItem(REDIRECT_PENDING_KEY)) return null
  sessionStorage.removeItem(REDIRECT_PENDING_KEY)
  try {
    const result = await getRedirectResult(auth)
    return result?.user ? await toProfile(result.user) : null
  } catch (err) {
    throw new Error(describeFirebaseError(err))
  }
}

export { auth, googleProvider }
