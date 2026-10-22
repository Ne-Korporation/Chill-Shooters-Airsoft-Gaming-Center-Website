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

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider)
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
