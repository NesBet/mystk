'use client'

import { useTheme } from '@/contexts/ThemeContext'

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      className="group relative flex h-10 w-10 items-center justify-center rounded-full border border-th-border bg-th-card text-th-secondary transition-all duration-200 hover:border-th-border-strong hover:text-th-text"
    >
      <span className="sr-only">Toggle theme</span>
      {isDark ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4.5 w-4.5 transition-transform duration-300 group-hover:rotate-45"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M4.7 4.7l1.4 1.4M17.9 17.9l1.4 1.4M2.5 12h2M19.5 12h2M4.7 19.3l1.4-1.4M17.9 6.1l1.4-1.4" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4.5 w-4.5 transition-transform duration-300 group-hover:-rotate-12"
        >
          <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  )
}
