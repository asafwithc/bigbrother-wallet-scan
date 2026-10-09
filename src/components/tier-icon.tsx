import { TIER_STYLE, type Tier } from "@/lib/tiers";

const GLYPH: Record<Tier, React.ReactNode> = {
  // crown
  crazy: <path d="M4 11.5 3 5.5l3 2.2L8 4l2 3.7 3-2.2-1 6z" fill="currentColor" stroke="none" />,
  // check
  proven: <path d="m4.6 8.3 2.3 2.3 4.5-4.9" />,
  // star
  good: (
    <path
      d="m8 3.6 1.3 2.8 3 .4-2.2 2.1.6 3L8 10.4l-2.7 1.5.6-3-2.2-2.1 3-.4z"
      fill="currentColor"
      stroke="none"
    />
  ),
  // question mark
  unknown: (
    <>
      <path d="M6.2 6.4a1.8 1.8 0 1 1 2.6 1.6c-.5.3-.8.7-.8 1.3" />
      <circle cx="8" cy="11.4" r=".5" fill="currentColor" stroke="none" />
    </>
  ),
  // cross
  farmer: <path d="m5.5 5.5 5 5m0-5-5 5" />,
};

/** Round tier badge icon: a dark glyph on the tier's colour. */
export function TierIcon({ tier, size = 16 }: { tier: Tier; size?: number | string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="shrink-0"
      style={{ color: "#0b0b0c" }}
    >
      <circle cx="8" cy="8" r="8" fill={TIER_STYLE[tier].color} />
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {GLYPH[tier]}
      </g>
    </svg>
  );
}
