import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyAWZ97DTTBq6FZSorJbn-NtzCzKCIxWf9E',
  authDomain: 'chill-shooters.firebaseapp.com',
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

export async function signInWithGoogle() {
  let result
  try {
    result = await signInWithPopup(auth, googleProvider)
  } catch (err) {
    throw new Error(describeFirebaseError(err))
  }
  const user = result.user
  return {
    name: user.displayName || '',
    email: user.email || '',
    uid: user.uid,
    // Sent to the API so it can confirm with Google that this sign-in really happened.
    idToken: await user.getIdToken(),
  }
}

export { auth, googleProvider }
