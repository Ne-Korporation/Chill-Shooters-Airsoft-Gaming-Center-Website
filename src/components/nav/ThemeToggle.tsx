import React from 'react'
import { FiMoon, FiSun } from 'react-icons/fi'
import { useTheme } from '../../context/ThemeContext'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="hover-row rounded-xl p-2 text-muted hover:text-text"
    >
      {theme === 'dark' ? <FiMoon /> : <FiSun />}
    </button>
  )
}
