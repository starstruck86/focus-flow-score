import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle } from 'lucide-react';

interface DeleteOpportunityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunityName: string;
  affectsQuota: boolean;
  onConfirm: () => void;
}

export function DeleteOpportunityDialog({
  open,
  onOpenChange,
  opportunityName,
  affectsQuota,
  onConfirm,
}: DeleteOpportunityDialogProps) {
  const [confirmText, setConfirmText] = useState('');

  const handleConfirm = () => {
    onConfirm();
    setConfirmText('');
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setConfirmText(''); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {affectsQuota && <AlertTriangle className="h-5 w-5 text-status-yellow" />}
            Delete Opportunity
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              Are you sure you want to delete <strong className="text-foreground">{opportunityName}</strong>?
            </span>
            {affectsQuota && (
              <span className="block text-status-yellow font-medium">
                ⚠️ This opportunity impacts quota/commissions. Deleting it will affect your attainment calculations.
              </span>
            )}
            <span className="block text-xs">
              Type <strong className="text-foreground">DELETE</strong> to confirm.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type DELETE to confirm"
          className="mt-2"
          autoFocus
        />
        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => { onOpenChange(false); setConfirmText(''); }}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={confirmText !== 'DELETE'}
            onClick={handleConfirm}
          >
            Delete Opportunity
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
