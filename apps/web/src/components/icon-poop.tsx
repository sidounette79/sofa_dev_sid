import { cn } from "@/lib/utils";

// 15.10, Sid ("si on peut meme y mettre une icone de caca, ca me ferait
// marrer"): mimics Tabler's icon prop signature (className, aria-hidden,
// strokeWidth accepted but unused) so it drops into the exact same
// `<Icon className="size-X" />` call sites as every real Tabler icon
// around it, without those call sites needing to know this one isn't SVG.
export function IconPoop({
  className,
  "aria-hidden": ariaHidden,
}: {
  className?: string;
  "aria-hidden"?: boolean;
  strokeWidth?: number;
}) {
  return (
    <span
      aria-hidden={ariaHidden}
      className={cn("inline-flex items-center justify-center text-[1.3em] leading-none", className)}
    >
      💩
    </span>
  );
}
