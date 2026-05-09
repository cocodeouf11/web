import { Button } from "../components/ui/button";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "../lib/theme";

export default function ThemeToggle({ size = "sm" }) {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size={size}
      onClick={toggle}
      data-testid="btn-theme-toggle"
      title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      className="rounded-lg"
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4" strokeWidth={1.6} />
      ) : (
        <Moon className="w-4 h-4" strokeWidth={1.6} />
      )}
    </Button>
  );
}
