import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(
  null,
);
export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("keydock.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* Storage can be unavailable in restricted browser contexts. */
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === "keydock.theme" || event.key === null)
        setTheme(readTheme());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem("keydock.theme", next);
    } catch {
      /* Keep the in-memory preference. */
    }
    setTheme(next);
  };
  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeProvider is required");
  return context;
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = `Switch to ${theme === "light" ? "dark" : "light"} theme`;
  return (
    <button
      className="icon-button theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
