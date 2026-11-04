import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { rejectSchema } from '@seatbook/shared';
import { ApiError } from '@/api/client';
import { FormField } from '@/components/FormField';
import { EmptyState, LoadError, LoadMore, LoadingRows } from '@/components/QueryStates';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useApplications, useReviewApplication, type ApplicationRow } from './useAdmin';

type Status = ApplicationRow['status'];
type RejectInput = z.infer<typeof rejectSchema>;

function reviewFailed(err: unknown) {
  toast.error(
    err instanceof ApiError && err.code === 'APPLICATION_ALREADY_REVIEWED'
      ? 'Another admin already reviewed this'
      : err instanceof Error
        ? err.message
        : 'Something went wrong',
  );
}

function RejectDialog({ row, onClose }: { row: ApplicationRow; onClose: () => void }) {
  const review = useReviewApplication();
  const form = useForm<RejectInput>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: '' },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {row.organizationName}?</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={form.handleSubmit((v) =>
            review
              .mutateAsync({ id: row._id, action: 'reject', reason: v.reason })
              .then(() => toast.success('Application rejected'))
              .catch(reviewFailed)
              .finally(onClose),
          )}
        >
          <FormField
            id="reason"
            label="Reason (emailed to the applicant)"
            error={form.formState.errors.reason?.message}
          >
            <Textarea id="reason" rows={3} {...form.register('reason')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={form.formState.isSubmitting}>
              Reject
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApproveDialog({ row, onClose }: { row: ApplicationRow; onClose: () => void }) {
  const review = useReviewApplication();
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve {row.organizationName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {row.userId?.name ?? 'This user'} will be able to create and sell events.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              review
                .mutateAsync({ id: row._id, action: 'approve' })
                .then(() => toast.success('Application approved'))
                .catch(reviewFailed)
            }
          >
            Approve
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ApplicationsPage() {
  const [status, setStatus] = useState<Status>('pending');
  const [dialog, setDialog] = useState<{
    row: ApplicationRow;
    action: 'approve' | 'reject';
  } | null>(null);
  const query = useApplications(status);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Organizer applications</h1>
      <Tabs value={status} onValueChange={(v) => setStatus(v as Status)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
      </Tabs>

      {query.isPending ? (
        <LoadingRows />
      ) : query.isError ? (
        <LoadError error={query.error} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${status} applications`} />
      ) : (
        <div className="rounded-md border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Applicant</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Submitted</TableHead>
                {status === 'pending' && <TableHead className="text-right">Review</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row._id}>
                  <TableCell>
                    <div className="font-medium">{row.userId?.name ?? 'Deleted user'}</div>
                    <div className="text-xs text-gray-500">{row.userId?.email}</div>
                  </TableCell>
                  <TableCell>
                    <div>{row.organizationName}</div>
                    {row.website && (
                      <a
                        href={row.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {row.website}
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal">
                    <details>
                      <summary className="cursor-pointer truncate">{row.message}</summary>
                      <p className="mt-1">{row.message}</p>
                    </details>
                    {row.rejectionReason && (
                      <p className="mt-1 text-xs text-red-700">Reason: {row.rejectionReason}</p>
                    )}
                  </TableCell>
                  <TableCell>{new Date(row.createdAt).toLocaleDateString()}</TableCell>
                  {status === 'pending' && (
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" onClick={() => setDialog({ row, action: 'approve' })}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDialog({ row, action: 'reject' })}
                      >
                        Reject
                      </Button>
                    </TableCell>
                  )}
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

      {dialog?.action === 'approve' && (
        <ApproveDialog row={dialog.row} onClose={() => setDialog(null)} />
      )}
      {dialog?.action === 'reject' && (
        <RejectDialog row={dialog.row} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
