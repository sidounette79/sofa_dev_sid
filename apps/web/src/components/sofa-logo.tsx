export function SofaLogo({ className }: { className?: string }) {
  return (
    <img
      src="/patoune-tv-logo.png"
      alt="Patoune TV"
      className={(className ?? "size-6") + " rounded-full object-contain"}
    />
  );
}
