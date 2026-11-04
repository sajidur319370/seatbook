import { Card } from '@/components/ui/card';
import { useMe } from '@/features/auth/useMe';
import { EventDetailsForm } from './EventDetailsForm';

export function NewEventPage() {
  const me = useMe();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">New event</h1>
      <Card className="p-6">
        <EventDetailsForm defaultTimezone={me.data?.user.timezone} />
      </Card>
    </div>
  );
}
