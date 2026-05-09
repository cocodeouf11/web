import { Button } from "../components/ui/button";

const POSITIONS = [
  ["top-left", "top-center", "top-right"],
  ["middle-left", "middle-center", "middle-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
];

const LABELS = {
  "top-left": "Haut gauche",
  "top-center": "Haut centre",
  "top-right": "Haut droite",
  "middle-left": "Milieu gauche",
  "middle-center": "Milieu centre",
  "middle-right": "Milieu droite",
  "bottom-left": "Bas gauche",
  "bottom-center": "Bas centre",
  "bottom-right": "Bas droite",
};

export function positionLabel(pos) {
  return LABELS[pos] || pos;
}

export default function SignaturePositionPicker({ value, onChange, disabled = false }) {
  return (
    <div data-testid="position-picker">
      <div className="text-xs uppercase tracking-[0.1em] font-semibold text-muted-foreground mb-3">
        Position de la signature sur le PDF
      </div>
      <div className="relative aspect-[1/1.4] max-w-[200px] mx-auto bg-muted/40 border border-border rounded-lg p-2">
        <div className="grid grid-rows-3 grid-cols-3 gap-1.5 h-full w-full">
          {POSITIONS.flat().map((pos) => {
            const selected = value === pos;
            return (
              <button
                key={pos}
                type="button"
                onClick={() => !disabled && onChange(pos)}
                disabled={disabled}
                title={LABELS[pos]}
                className={[
                  "rounded-md border transition-all duration-150 flex items-center justify-center",
                  selected
                    ? "bg-brand border-brand shadow-sm"
                    : "bg-card border-border hover:border-foreground/30 hover:bg-muted",
                  disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
                data-testid={`pos-${pos}`}
              >
                {selected && (
                  <div className="w-3 h-1 rounded-sm bg-white" />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="text-center text-sm text-muted-foreground mt-3">
        {LABELS[value] || "Bas droite"}
      </div>
    </div>
  );
}
