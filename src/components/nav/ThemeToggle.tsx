import React from 'react'
import { FiMoon, FiSun } from 'react-icons/fi'
import { useTheme } from '../../context/ThemeContext'
import { Button } from '../ui/Button'


export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-10 px-3"
      onClick={toggleTheme}
    >
      {theme === 'dark' ? <FiMoon /> : <FiSun />}
      <span className="hidden sm:inline">{theme === 'dark' ? 'Dark' : 'Light'}</span>
    </Button>
  )
}

