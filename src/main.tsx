import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/index.css'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'

// Every toast uses the app's card look (see .app-toast in styles/theme.css), in light and dark mode.
// Icons use the app's success green and danger red; the inner colour matches the card behind them.
const toastOptions = {
  duration: 3000,
  className: 'app-toast',
  success: {
    className: 'app-toast app-toast-success',
    iconTheme: { primary: 'rgb(63,163,77)', secondary: 'rgb(var(--card))' },
  },
  error: {
    className: 'app-toast app-toast-error',
    iconTheme: { primary: 'rgb(214,69,69)', secondary: 'rgb(var(--card))' },
  },
  loading: {
    iconTheme: { primary: 'rgb(197,163,90)', secondary: 'rgba(197,163,90,0.25)' },
  },
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <App />
          {/* Above every pop-up (the highest go up to 100002), so messages are never hidden behind one. */}
          <Toaster position="top-right" toastOptions={toastOptions} containerStyle={{ zIndex: 200000 }} />
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
