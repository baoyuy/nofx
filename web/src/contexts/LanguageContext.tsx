import { createContext, useContext, useState, ReactNode } from 'react'
import type { Language } from '../i18n/translations'

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
)

const SUPPORTED: Language[] = ['en', 'zh', 'id']

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem('language')
    if (stored && SUPPORTED.includes(stored as Language)) {
      return stored as Language
    }
  } catch {
    // localStorage unavailable; fall through to default
  }
  // This fork defaults to Chinese; users can switch in the language menu.
  return 'zh'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage)

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    try {
      localStorage.setItem('language', lang)
    } catch {
      // ignore persistence failures
    }
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider')
  }
  return context
}
