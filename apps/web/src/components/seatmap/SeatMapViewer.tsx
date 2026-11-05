import {
  memo,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import {
  TransformComponent,
  TransformWrapper,
  useControls,
  type ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import { formatMoney, type SeatMapResponse, type TierInput } from '@seatbook/shared';
import { Button } from '@/components/ui/button';
import { CELL, PAD, SEAT_R, bounds, viewBox } from './geometry';
import { STATUS_TEXT, Seat, type SeatVisual } from './Seat';
import { TIER_HEX } from './tierColors';
import { nearestSeat, useRenderSeats, type RenderSeat } from './useSeatCells';

/** A press that moved further than this was a drag across the map, not a click on a seat. */
const DRAG_PX = 5;

/**
 * FR-VIEW-02: enough zoom for a 24 px seat, even when the whole map starts squeezed into the 280 px
 * a small phone leaves it. A 5,000-seat map begins near 2 px per seat, so a fixed limit can't get there.
 */
function maxScaleFor(b: ReturnType<typeof bounds>) {
  const cells = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 2 * PAD + 1;
  return Math.max(8, Math.ceil((24 / (2 * SEAT_R)) * ((cells * CELL) / 280)));
}

function ZoomButtons() {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
      <Button size="icon" variant="outline" aria-label="Zoom in" onClick={() => zoomIn()}>
        <Plus className="size-4" />
      </Button>
      <Button size="icon" variant="outline" aria-label="Zoom out" onClick={() => zoomOut()}>
        <Minus className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="outline"
        aria-label="Fit the map"
        onClick={() => resetTransform()}
      >
        <Maximize className="size-4" />
      </Button>
    </div>
  );
}

function SeatTooltip(props: {
  seat: RenderSeat;
  tier: TierInput;
  currency: SeatMapResponse['event']['currency'];
  status: SeatVisual;
}) {
  const { seat, tier } = props;
  return (
    <div
      role="status"
      data-testid="seat-tooltip"
      className="pointer-events-none absolute top-2 left-2 z-10 max-w-[calc(100%-4rem)] rounded-md bg-gray-900 px-2 py-1 text-xs text-white"
    >
      {seat.section} · Row {seat.row} · Seat {seat.n} — {tier.name} —{' '}
      {formatMoney(seat.price, props.currency)} — {STATUS_TEXT[props.status]}
    </div>
  );
}

/**
 * Behind `memo`, so a hover (which lives in the parent) re-renders no seats at all, and a status
 * change re-renders only the seat whose `visual` prop actually changed.
 */
const SeatLayer = memo(function SeatLayer(props: {
  seats: RenderSeat[];
  colors: string[];
  visualOf: (id: string) => SeatVisual;
  highlightTier: number | null;
  interactive: boolean;
  tabbableId: string | null;
}) {
  return (
    <>
      {props.seats.map((s) => {
        const visual = props.visualOf(s.id);
        return (
          <Seat
            key={s.id}
            id={s.id}
            x={s.x}
            y={s.y}
            label={s.label}
            description={s.description}
            tierColor={props.colors[s.tierIndex]!}
            visual={visual}
            // Your own seats never fade: you must always be able to see what you hold.
            dimmed={
              props.highlightTier !== null &&
              s.tierIndex !== props.highlightTier &&
              visual !== 'mine' &&
              visual !== 'pending'
            }
            interactive={props.interactive}
            tabbable={s.id === props.tabbableId}
          />
        );
      })}
    </>
  );
});

export function SeatMapViewer(props: {
  data: SeatMapResponse;
  /** Must be stable (useCallback), or every seat re-renders whenever the parent does. */
  visualOf: (id: string) => SeatVisual;
  onSeatClick?: (seat: RenderSeat) => void;
  highlightTier?: number | null;
  /** Inside a scrolling page: shorter, and the mouse wheel scrolls the page instead of zooming. */
  embedded?: boolean;
}) {
  const { data, visualOf, onSeatClick, embedded = false } = props;
  const seats = useRenderSeats(data);
  const byId = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats]);
  const colors = useMemo(() => data.tiers.map((t) => TIER_HEX[t.color]), [data.tiers]);
  const b = useMemo(() => bounds(seats), [seats]);
  const [hover, setHover] = useState<RenderSeat | null>(null);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const transform = useRef<ReactZoomPanPinchContentRef>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabbableId = useMemo(() => {
    if (!onSeatClick) return null;
    if (focusId) return focusId;
    return (seats.find((s) => visualOf(s.id) === 'available') ?? seats[0])?.id ?? null;
  }, [onSeatClick, focusId, seats, visualOf]);
  const [zoomedIn, setZoomedIn] = useState(false);
  // On a page, one finger must still scroll past the map. It only pans once the map is zoomed in.
  const fingerScrollsPage = embedded && !zoomedIn;

  const seatFrom = (e: SyntheticEvent) => {
    const id = (e.target as Element).closest('[data-seat-id]')?.getAttribute('data-seat-id');
    return id ? (byId.get(id) ?? null) : null;
  };

  const onClick = (e: MouseEvent) => {
    const start = pressedAt.current;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_PX) return;
    const seat = seatFrom(e);
    if (!seat) return;
    if (onSeatClick) {
      setFocusId(seat.id);
      onSeatClick(seat);
    } else {
      setHover(seat); // a phone has no hover: tapping shows the same details
    }
  };

  /** Pans just enough to keep the focused seat on screen when the map is zoomed in. */
  const keepInView = (el: Element) => {
    const api = transform.current;
    if (!api) return;
    const area = api.instance.wrapperComponent?.getBoundingClientRect();
    if (!area) return;
    const seat = el.getBoundingClientRect();
    const margin = 32;
    const dx =
      seat.left < area.left + margin
        ? area.left + margin - seat.left
        : seat.right > area.right - margin
          ? area.right - margin - seat.right
          : 0;
    const dy =
      seat.top < area.top + margin
        ? area.top + margin - seat.top
        : seat.bottom > area.bottom - margin
          ? area.bottom - margin - seat.bottom
          : 0;
    if (!dx && !dy) return;
    const { positionX, positionY, scale } = api.instance.state;
    api.setTransform(positionX + dx, positionY + dy, scale, 120);
  };

  // NFR-A11Y-03: arrow keys move between seats; Enter or Space acts on the focused one.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!onSeatClick) return;
    const current = seatFrom(e);
    if (!current) return;
    if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight'
    ) {
      e.preventDefault();
      const next = nearestSeat(seats, current, e.key);
      if (!next) return;
      setFocusId(next.id);
      const el = svgRef.current?.querySelector<SVGGElement>(`[data-seat-id="${next.id}"]`);
      el?.focus({ preventScroll: true });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSeatClick(current);
    }
  };

  const onFocus = (e: FocusEvent) => {
    setHover(seatFrom(e));
    // Tab and arrow keys can land off screen. A click lands on a seat you can already see.
    const el = e.target as Element;
    if (el.matches(':focus-visible')) keepInView(el);
  };

  return (
    <div className="relative rounded-xl border bg-white">
      <TransformWrapper
        ref={transform}
        minScale={0.6}
        maxScale={maxScaleFor(b)}
        centerOnInit
        centerZoomedOut
        wheel={{ step: 0.15, disabled: embedded }}
        doubleClick={{ disabled: true }}
        panning={{ disabled: fingerScrollsPage }}
        onTransform={(_, state) => setZoomedIn(state.scale > 1.01)}
      >
        <ZoomButtons />
        <TransformComponent
          wrapperClass={embedded ? '!h-[45vh] !w-full' : '!h-[70vh] !w-full'}
          contentClass="!h-full !w-full"
        >
          {/* One set of handlers here, not 5,000 on the seats. */}
          <svg
            ref={svgRef}
            viewBox={viewBox(b)}
            role="group"
            aria-label={
              onSeatClick
                ? 'Seat map. Use the arrow keys to move between seats, and Enter to select one.'
                : 'Seat map'
            }
            className={`h-full w-full select-none ${fingerScrollsPage ? 'touch-pan-y' : 'touch-none'}`}
            onPointerDown={(e) => {
              pressedAt.current = { x: e.clientX, y: e.clientY };
            }}
            onClick={onClick}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            onBlur={() => setHover(null)}
            onMouseMove={(e) => setHover(seatFrom(e))}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <pattern
                id="hatch"
                width="4"
                height="4"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="4" stroke="#6b7280" strokeWidth="1.5" />
              </pattern>
            </defs>
            <rect
              x={b.minX * CELL}
              y={(b.minY - 3) * CELL}
              width={(b.maxX - b.minX + 1) * CELL}
              height={CELL * 1.6}
              rx={4}
              fill="#111827"
            />
            <text
              x={((b.minX + b.maxX + 1) / 2) * CELL}
              y={(b.minY - 2.2) * CELL}
              textAnchor="middle"
              fill="white"
              fontSize={8}
              dominantBaseline="middle"
            >
              {data.layout.stageLabel}
            </text>
            <SeatLayer
              seats={seats}
              colors={colors}
              visualOf={visualOf}
              highlightTier={props.highlightTier ?? null}
              interactive={!!onSeatClick}
              tabbableId={tabbableId}
            />
          </svg>
        </TransformComponent>
      </TransformWrapper>
      {hover && (
        <SeatTooltip
          seat={hover}
          tier={data.tiers[hover.tierIndex]!}
          currency={data.event.currency}
          status={visualOf(hover.id)}
        />
      )}
    </div>
  );
}
