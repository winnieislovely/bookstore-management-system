/**
 * Wordmark placeholder (Design §3). The supplied logo is a raster square; until the SVG arrives
 * (Design §3.1 asset request) this renders the name in the brand layout, white on navy.
 */
export function Wordmark({ width = 168 }: { width?: number }) {
  return (
    <div style={{ width }} className="select-none text-white" aria-label="The Bookshelf Hanoi" role="img">
      <div className="text-[10px] font-semibold tracking-[0.3em]">THE</div>
      <div className="text-[22px] leading-6 font-bold tracking-[0.18em]">BOOKSHELF</div>
      <div className="text-right text-[10px] font-semibold tracking-[0.3em]">HANOI</div>
    </div>
  );
}

export function CompactMark() {
  return (
    <div className="flex size-10 items-center justify-center rounded-md bg-navy-900 text-sm font-bold tracking-wider text-white" aria-label="The Bookshelf Hanoi" role="img">
      TB
    </div>
  );
}
