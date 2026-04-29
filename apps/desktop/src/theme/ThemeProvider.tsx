import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: Theme;
  setTheme: (theme: ThemePreference) => void;
}

const storageKey = 'courrier-theme';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): Theme {
  if (
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }

  return 'light';
}

function getInitialTheme(): Theme {
  const storedTheme = window.localStorage.getItem(storageKey);

  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme;
  }

  return getSystemTheme();
}

function getInitialPreference(): ThemePreference {
  const storedTheme = window.localStorage.getItem(storageKey);

  if (
    storedTheme === 'light' ||
    storedTheme === 'dark' ||
    storedTheme === 'system'
  ) {
    return storedTheme;
  }

  return 'system';
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>(getInitialPreference);
  const [systemTheme, setSystemTheme] = useState<Theme>(getInitialTheme);
  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      setSystemTheme(query.matches ? 'dark' : 'light');
    };

    handleChange();
    query.addEventListener('change', handleChange);

    return () => {
      query.removeEventListener('change', handleChange);
    };
  }, []);

  useEffect(() => {
    applyTheme(resolvedTheme);
    window.localStorage.setItem(storageKey, theme);
  }, [resolvedTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
    }),
    [resolvedTheme, theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider.');
  }

  return context;
}
