import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

export function FormField(props: {
  id: string;
  label: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
      {props.error && <p className="text-sm text-red-600">{props.error}</p>}
    </div>
  );
}
