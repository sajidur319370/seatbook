import { memo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  concertHall,
  conferenceRoom,
  formatMoney,
  generateSeats,
  PALETTE,
  smallTheatre,
  type Currency,
  type SectionInput,
  type TierInput,
} from '@seatbook/shared';
import { FormField } from '@/components/FormField';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SWATCH } from '@/lib/palette';
import { useBuilder } from './builderStore';
import { NumberInput, NumberListInput, PriceInput } from './inputs';
import { RowGeneratorDialog } from './RowGeneratorDialog';
import { useBuilderDerived } from './useBuilderDerived';

/** Errors arrive as one string, so a memoized row can compare them cheaply. */
function FieldErrors({ text }: { text: string }) {
  if (!text) return null;
  const messages = text.split('\n');
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-red-600">
      {messages.slice(0, 5).map((m, i) => (
        <li key={i}>{m}</li>
      ))}
      {messages.length > 5 && <li>…and {messages.length - 5} more</li>}
    </ul>
  );
}

const TEMPLATES = [
  ['Small theatre', smallTheatre],
  ['Concert hall', concertHall],
  ['Conference room', conferenceRoom],
] as const;

export function TemplatesPanel() {
  const applyTemplate = useBuilder((s) => s.applyTemplate);
  const isEmpty = useBuilder((s) => s.layout.sections.length === 0);
  const [pending, setPending] = useState<(typeof TEMPLATES)[number] | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">Start from a template:</span>
      {TEMPLATES.map((t) => (
        <Button
          key={t[0]}
          variant="outline"
          size="sm"
          onClick={() => (isEmpty ? applyTemplate(t[1]()) : setPending(t))}
        >
          {t[0]} ({generateSeats(t[1]()).length})
        </Button>
      ))}
      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace this layout?</AlertDialogTitle>
            <AlertDialogDescription>
              The current sections and tiers will be replaced by the {pending?.[0]} template.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending && applyTemplate(pending[1]())}>
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function TiersPanel({ currency }: { currency: Currency }) {
  const tiers = useBuilder((s) => s.layout.tiers);
  const sections = useBuilder((s) => s.layout.sections);
  const { addTier, updateTier, removeTier } = useBuilder.getState();
  const { errorsAt } = useBuilderDerived();
  const usedBy = (id: string) =>
    sections.reduce((n, s) => n + s.rows.filter((r) => r.tierId === id).length, 0);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Price tiers</h2>
        <Button variant="outline" size="sm" onClick={addTier}>
          Add tier
        </Button>
      </div>
      {tiers.length === 0 && (
        <p className="text-sm text-gray-600">Add a tier before adding rows.</p>
      )}
      {tiers.map((t, i) => {
        const used = usedBy(t._id);
        return (
          <div key={t._id} className="space-y-2 rounded-md border p-2" data-testid={`tier-${i}`}>
            <div className="flex gap-2">
              <Input
                aria-label={`Tier ${i + 1} name`}
                value={t.name}
                onChange={(e) => updateTier(t._id, { name: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                disabled={used > 0}
                aria-label={`Delete tier ${t.name}`}
                title={used > 0 ? `Used by ${used} rows` : 'Delete tier'}
                onClick={() => removeTier(t._id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <PriceInput
                label={`Tier ${i + 1} price`}
                minor={t.price}
                onChange={(price) => updateTier(t._id, { price })}
              />
              <span className="shrink-0 text-sm text-gray-600">
                {formatMoney(t.price, currency)}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`${t.name}: ${color}`}
                  aria-pressed={t.color === color}
                  onClick={() => updateTier(t._id, { color })}
                  className={`size-5 rounded-full ${SWATCH[color]} ${t.color === color ? 'ring-2 ring-gray-900 ring-offset-1' : ''}`}
                />
              ))}
            </div>
            <FieldErrors text={errorsAt(['tiers', i]).join('\n')} />
          </div>
        );
      })}
    </Card>
  );
}

export function TotalsPanel({ currency }: { currency: Currency }) {
  const { total, sellable, blocked, perTier, tooManyToDraw } = useBuilderDerived();
  return (
    <Card className="space-y-2 p-4 text-sm">
      <h2 className="font-semibold">Totals</h2>
      <dl className="grid grid-cols-3 gap-2">
        <div>
          <dt className="text-gray-600">Seats</dt>
          <dd className="text-lg font-semibold" data-testid="total-seats">
            {total.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-gray-600">For sale</dt>
          <dd className="text-lg font-semibold" data-testid="sellable-seats">
            {tooManyToDraw ? '—' : sellable.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-gray-600">Blocked</dt>
          <dd className="text-lg font-semibold" data-testid="blocked-seats">
            {tooManyToDraw ? '—' : blocked.toLocaleString()}
          </dd>
        </div>
      </dl>
      {perTier.map(({ tier, sellable: n, potential }) => (
        <p key={tier._id} className="flex justify-between gap-2">
          <span className="truncate">
            {tier.name}: {n} × {formatMoney(tier.price, currency)}
          </span>
          <span className="shrink-0 font-medium">{formatMoney(potential, currency)}</span>
        </p>
      ))}
    </Card>
  );
}

const SectionCard = memo(function SectionCard(props: {
  s: SectionInput;
  i: number;
  selected: boolean;
  errors: string;
  onDelete: (target: { id: string; name: string }) => void;
}) {
  const { s, i, selected, errors, onDelete } = props;
  const { updateSection, selectSection } = useBuilder.getState();
  return (
    <div
      data-testid={`section-${i}`}
      onClick={() => selectSection(s._id)}
      className={`space-y-2 rounded-md border p-2 ${selected ? 'border-blue-500 bg-blue-50' : ''}`}
    >
      <div className="flex gap-2">
        <Input
          id={`section-name-${i}`}
          aria-label={`Section ${i + 1} name`}
          value={s.name}
          onChange={(e) => updateSection(s._id, { name: e.target.value })}
        />
        <Input
          id={`section-code-${i}`}
          aria-label={`Section ${i + 1} code`}
          className="w-20 shrink-0"
          value={s.code}
          onChange={(e) => updateSection(s._id, { code: e.target.value.toUpperCase() })}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete section ${s.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete({ id: s._id, name: s.name });
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          x
          <NumberInput
            id={`section-x-${i}`}
            label={`Section ${i + 1} x`}
            className="w-20"
            min={0}
            value={s.x}
            onChange={(x) => updateSection(s._id, { x })}
          />
        </label>
        <label className="flex items-center gap-1">
          y
          <NumberInput
            id={`section-y-${i}`}
            label={`Section ${i + 1} y`}
            className="w-20"
            min={0}
            value={s.y}
            onChange={(y) => updateSection(s._id, { y })}
          />
        </label>
        <Select
          value={s.numbering}
          onValueChange={(numbering) =>
            updateSection(s._id, { numbering: numbering as 'ltr' | 'rtl' })
          }
        >
          <SelectTrigger size="sm" aria-label={`Section ${i + 1} numbering`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ltr">Seat 1 on the left</SelectItem>
            <SelectItem value="rtl">Seat 1 on the right</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <FieldErrors text={errors} />
    </div>
  );
});

const RowEditor = memo(function RowEditor(props: {
  sectionId: string;
  r: SectionInput['rows'][number];
  ri: number;
  tiers: TierInput[];
  errors: string;
}) {
  const { sectionId, r, ri, tiers, errors } = props;
  const { updateRow, removeRow } = useBuilder.getState();
  return (
    <TableRow data-testid={`row-${r.label}`} className="align-top">
      <TableCell>
        <Input
          aria-label={`Row ${ri + 1} label`}
          className="w-16"
          value={r.label}
          onChange={(e) => updateRow(sectionId, ri, { label: e.target.value.toUpperCase() })}
        />
        <FieldErrors text={errors} />
      </TableCell>
      <TableCell>
        <NumberInput
          label={`Row ${r.label} seats`}
          className="w-20"
          min={1}
          value={r.seats}
          onChange={(seats) => updateRow(sectionId, ri, { seats })}
        />
      </TableCell>
      <TableCell>
        <NumberInput
          label={`Row ${r.label} offset`}
          className="w-20"
          min={0}
          value={r.offset}
          onChange={(offset) => updateRow(sectionId, ri, { offset })}
        />
      </TableCell>
      <TableCell>
        <Select value={r.tierId} onValueChange={(tierId) => updateRow(sectionId, ri, { tierId })}>
          <SelectTrigger size="sm" aria-label={`Row ${r.label} tier`}>
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
      </TableCell>
      <TableCell>
        <NumberListInput
          label={`Row ${r.label} aisle after`}
          value={r.gapsAfter}
          onChange={(gapsAfter) => updateRow(sectionId, ri, { gapsAfter })}
        />
      </TableCell>
      <TableCell>
        <NumberListInput
          label={`Row ${r.label} blocked`}
          value={r.blocked}
          onChange={(blocked) => updateRow(sectionId, ri, { blocked })}
        />
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete row ${r.label}`}
          onClick={() => removeRow(sectionId, ri)}
        >
          <Trash2 className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
});

export function SectionsPanel() {
  const sections = useBuilder((s) => s.layout.sections);
  const selected = useBuilder((s) => s.selectedSectionId);
  const stageLabel = useBuilder((s) => s.layout.stageLabel);
  const { addSection, removeSection, setStageLabel } = useBuilder.getState();
  const { errorsAt } = useBuilderDerived();
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Sections</h2>
        <Button variant="outline" size="sm" onClick={addSection}>
          Add section
        </Button>
      </div>
      <FormField id="stage-label" label="Stage label">
        <Input
          id="stage-label"
          value={stageLabel}
          onChange={(e) => setStageLabel(e.target.value)}
        />
      </FormField>
      {sections.map((section, i) => (
        <SectionCard
          key={section._id}
          s={section}
          i={i}
          selected={selected === section._id}
          errors={errorsAt(['sections', i]).join('\n')}
          onDelete={setDeleting}
        />
      ))}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the section and its rows.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && removeSection(deleting.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function RowsPanel() {
  const sections = useBuilder((s) => s.layout.sections);
  const selected = useBuilder((s) => s.selectedSectionId);
  const tiers = useBuilder((s) => s.layout.tiers);
  const { errorsAt } = useBuilderDerived();
  const [generating, setGenerating] = useState(false);

  const si = sections.findIndex((s) => s._id === selected);
  const section = sections[si];

  if (!section) {
    return (
      <Card className="p-8 text-center text-gray-600">
        Add your first section, or start from a template.
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Rows in {section.name}</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={tiers.length === 0}
          title={tiers.length === 0 ? 'Add a price tier first' : undefined}
          onClick={() => setGenerating(true)}
        >
          Add rows
        </Button>
      </div>
      {section.rows.length === 0 ? (
        <p className="text-sm text-gray-600">No rows yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Offset</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Aisle after</TableHead>
              <TableHead>Blocked</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.rows.map((r, ri) => (
              <RowEditor
                key={ri}
                sectionId={section._id}
                r={r}
                ri={ri}
                tiers={tiers}
                errors={errorsAt(['sections', si, 'rows', ri]).join('\n')}
              />
            ))}
          </TableBody>
        </Table>
      )}
      {generating && (
        <RowGeneratorDialog
          sectionId={section._id}
          existingRows={section.rows.length}
          onClose={() => setGenerating(false)}
        />
      )}
    </Card>
  );
}
