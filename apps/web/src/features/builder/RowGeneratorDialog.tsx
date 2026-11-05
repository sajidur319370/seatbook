import { useState } from 'react';
import { toast } from 'sonner';
import { LIMITS, ROW_LABEL, rowRange } from '@seatbook/shared';
import { FormField } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useBuilder } from './builderStore';

export function RowGeneratorDialog({
  sectionId,
  existingRows,
  onClose,
}: {
  sectionId: string;
  existingRows: number;
  onClose: () => void;
}) {
  const tiers = useBuilder((s) => s.layout.tiers);
  const generateRows = useBuilder((s) => s.generateRows);
  const [from, setFrom] = useState('A');
  const [to, setTo] = useState('J');
  const [seats, setSeats] = useState(20);
  const [tierId, setTierId] = useState(tiers[0]?._id ?? '');
  const [stagger, setStagger] = useState(false);
  const [aisle, setAisle] = useState<number | null>(null);

  const labelsOk = ROW_LABEL.test(from) && ROW_LABEL.test(to);
  const count = labelsOk ? rowRange(from, to).length : 0;
  const problem = !labelsOk
    ? 'Row labels are 1–2 capital letters.'
    : count === 0
      ? '"From" must come before "to".'
      : existingRows + count > LIMITS.rowsPerSection
        ? `A section can have at most ${LIMITS.rowsPerSection} rows.`
        : !Number.isInteger(seats) || seats < 1 || seats > LIMITS.seatsPerRow
          ? `Seats per row must be 1–${LIMITS.seatsPerRow}.`
          : aisle !== null && (aisle < 1 || aisle >= seats)
            ? 'The aisle must come after a seat in the row, before the last one.'
            : null;

  const submit = () => {
    const skipped = generateRows(sectionId, {
      from,
      to,
      seats,
      tierId,
      stagger,
      gapsAfter: aisle === null ? [] : [aisle],
    });
    const added = count - skipped;
    toast.success(
      skipped
        ? `Added ${added} rows. Skipped ${skipped} that already exist.`
        : `Added ${added} rows.`,
    );
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add rows</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <FormField id="gen-from" label="From row">
            <Input
              id="gen-from"
              value={from}
              onChange={(e) => setFrom(e.target.value.toUpperCase())}
            />
          </FormField>
          <FormField id="gen-to" label="To row">
            <Input id="gen-to" value={to} onChange={(e) => setTo(e.target.value.toUpperCase())} />
          </FormField>
          <FormField id="gen-seats" label="Seats per row">
            <Input
              id="gen-seats"
              type="number"
              min={1}
              max={LIMITS.seatsPerRow}
              value={Number.isNaN(seats) ? '' : seats}
              onChange={(e) => setSeats(e.target.valueAsNumber)}
            />
          </FormField>
          <FormField id="gen-aisle" label="Aisle after seat (optional)">
            <Input
              id="gen-aisle"
              type="number"
              min={1}
              value={aisle ?? ''}
              onChange={(e) =>
                setAisle(Number.isNaN(e.target.valueAsNumber) ? null : e.target.valueAsNumber)
              }
            />
          </FormField>
          <FormField id="gen-tier" label="Tier">
            <Select value={tierId} onValueChange={setTierId}>
              <SelectTrigger id="gen-tier" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tiers.map((t) => (
                  <SelectItem key={t._id} value={t._id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="gen-stagger" label="Stagger every other row">
            <div className="pt-1">
              <Switch id="gen-stagger" checked={stagger} onCheckedChange={setStagger} />
            </div>
          </FormField>
        </div>
        {problem && <p className="text-sm text-red-600">{problem}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!problem || !tierId} onClick={submit}>
            Add {count > 0 ? `${count} rows` : 'rows'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
