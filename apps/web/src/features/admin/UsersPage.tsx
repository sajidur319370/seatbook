import { useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { ROLES, type Role } from '@seatbook/shared';
import { FormField } from '@/components/FormField';
import { EmptyState, LoadError, LoadMore, LoadingRows } from '@/components/QueryStates';
import { Badge } from '@/components/ui/badge';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useDebounced } from '@/lib/useDebounced';
import { useUpdateUser, useUsers, type UserFilters, type UserRow } from './useAdmin';

const showError = (err: unknown) =>
  toast.error(err instanceof Error ? err.message : 'Something went wrong');

function SuspendDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const update = useUpdateUser();
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < 5;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suspend {user.name}?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          They'll be logged out everywhere and can't log back in until you unsuspend them.
        </p>
        <FormField id="suspend-reason" label="Reason (emailed to the user)">
          <Textarea
            id="suspend-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={tooShort || update.isPending}
            onClick={() =>
              update
                .mutateAsync({ id: user._id, patch: { suspended: true, reason: reason.trim() } })
                .then(() => toast.success(`${user.name} suspended`))
                .catch(showError)
                .finally(onClose)
            }
          >
            Suspend
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserControls({ user, onSuspend }: { user: UserRow; onSuspend: () => void }) {
  const update = useUpdateUser();
  return (
    <div className="flex items-center justify-end gap-2">
      <Select
        value={user.role}
        disabled={update.isPending}
        onValueChange={(role) =>
          update
            .mutateAsync({ id: user._id, patch: { role: role as 'attendee' | 'organizer' } })
            .then(() => toast.success(`${user.name} is now an ${role}`))
            .catch(showError)
        }
      >
        <SelectTrigger size="sm" className="w-32 capitalize" aria-label={`Role of ${user.name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="attendee">Attendee</SelectItem>
          <SelectItem value="organizer">Organizer</SelectItem>
        </SelectContent>
      </Select>
      {user.suspendedAt ? (
        <Button
          size="sm"
          variant="outline"
          disabled={update.isPending}
          onClick={() =>
            update
              .mutateAsync({ id: user._id, patch: { suspended: false } })
              .then(() => toast.success(`${user.name} unsuspended`))
              .catch(showError)
          }
        >
          Unsuspend
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onSuspend}>
          Suspend
        </Button>
      )}
    </div>
  );
}

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserFilters['role']>('all');
  const [suspended, setSuspended] = useState<UserFilters['suspended']>('all');
  const [suspending, setSuspending] = useState<UserRow | null>(null);
  const q = useDebounced(search);
  const query = useUsers({ q, role, suspended });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Search users"
          placeholder="Search by name or email"
          className="max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={role} onValueChange={(v) => setRole(v as Role | 'all')}>
          <SelectTrigger className="w-36 capitalize" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r} className="capitalize">
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={suspended}
          onValueChange={(v) => setSuspended(v as UserFilters['suspended'])}
        >
          <SelectTrigger className="w-36" aria-label="Filter by suspension">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="false">Active</SelectItem>
            <SelectItem value="true">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {query.isPending ? (
        <LoadingRows />
      ) : query.isError ? (
        <LoadError error={query.error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No users match these filters" />
      ) : (
        <div className="rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => (
                <TableRow key={user._id} data-testid={`user-${user.email}`}>
                  <TableCell>
                    <div className="font-medium">{user.name}</div>
                    <div className="text-xs text-gray-500">{user.email}</div>
                  </TableCell>
                  <TableCell>
                    {user.suspendedAt ? (
                      <Badge variant="destructive">Suspended</Badge>
                    ) : (
                      <Badge variant="secondary" className="capitalize">
                        {user.role}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.role === 'admin' ? (
                      <div className="flex justify-end text-gray-500">
                        <Lock className="size-4" aria-label="Admins can't be changed here" />
                      </div>
                    ) : (
                      <UserControls user={user} onSuspend={() => setSuspending(user)} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <LoadMore
        hasMore={query.hasNextPage}
        loading={query.isFetchingNextPage}
        onClick={() => query.fetchNextPage()}
      />
      {suspending && <SuspendDialog user={suspending} onClose={() => setSuspending(null)} />}
    </div>
  );
}
