/**
 * The approved Flico logo, used exactly as supplied (docs/handoff/02_Design/assets/flico-logo-reference-crop.png).
 * The raster has a baked-in off-white background (#FDFCF8), so place it only on light surfaces.
 * A transparent production master is still needed — see DECISIONS.md.
 */
export function Logo({ width = 128 }: { width?: number }) {
  return (
    <img
      src="/brand/flico-logo.png"
      alt="Flico"
      width={width}
      height={Math.round((width * 247) / 786)}
      className="block h-auto select-none"
      draggable={false}
    />
  );
}
