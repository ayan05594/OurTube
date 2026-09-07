import Link from "next/link";

type BrandProps = {
  compact?: boolean;
  href?: string;
};

export function Brand({ compact = false, href = "/" }: BrandProps) {
  return (
    <Link
      className={`brand${compact ? " brand--compact" : ""}`}
      href={href}
      aria-label="OurTube home"
    >
      <span className="brand__mark" aria-hidden="true">
        <span>♥</span>
      </span>
      <span className="brand__name">OurTube</span>
    </Link>
  );
}
