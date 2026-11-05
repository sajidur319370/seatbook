import { useState } from 'react';
import { toMinor } from '@seatbook/shared';
import { Input } from '@/components/ui/input';

export const parseNumberList = (s: string) =>
  [
    ...new Set(
      s
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ].sort((a, b) => a - b);

/**
 * While focused these show exactly what's typed. A half-typed "10," or "4." can't round-trip
 * through the stored value, so a plain controlled input would erase it on every keystroke.
 */
export function NumberListInput(props: {
  id?: string;
  label: string;
  value: number[];
  disabled?: boolean;
  onChange: (value: number[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      id={props.id}
      aria-label={props.label}
      placeholder="None"
      disabled={props.disabled}
      value={draft ?? props.value.join(', ')}
      onFocus={() => setDraft(props.value.join(', '))}
      onChange={(e) => {
        setDraft(e.target.value);
        props.onChange(parseNumberList(e.target.value));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function PriceInput(props: {
  id?: string;
  label: string;
  minor: number;
  disabled?: boolean;
  onChange: (minor: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = (props.minor / 100).toFixed(2);
  const invalid = draft !== null && toMinor(draft) === null;
  return (
    <Input
      id={props.id}
      aria-label={props.label}
      aria-invalid={invalid}
      inputMode="decimal"
      disabled={props.disabled}
      className={invalid ? 'border-red-500' : undefined}
      value={draft ?? shown}
      onFocus={() => setDraft(shown)}
      onChange={(e) => {
        setDraft(e.target.value);
        const minor = toMinor(e.target.value);
        if (minor !== null) props.onChange(minor);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** A blank number input becomes NaN in the store, which the schema reports; it must show as empty. */
export function NumberInput(props: {
  id?: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  className?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      id={props.id}
      aria-label={props.label}
      type="number"
      min={props.min}
      max={props.max}
      className={props.className}
      value={Number.isNaN(props.value) ? '' : props.value}
      onChange={(e) => props.onChange(e.target.valueAsNumber)}
    />
  );
}
