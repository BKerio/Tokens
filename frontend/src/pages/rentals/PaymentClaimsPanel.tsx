import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Check, Inbox, Smartphone, X } from 'lucide-react';
import { confirmPaymentClaim, listPaymentClaims, rejectPaymentClaim } from '@/api/rentals';
import { errorMessage } from '@/api/client';
import { confirmDialog, notify, promptDialog } from '@/lib/alert';
import { fmtKes } from '@/lib/format';
import { useLandlordAccess } from '@/hooks/useLandlordAccess';
import AppLoader from '@/components/shared/AppLoader';
import type { RentPaymentClaim } from '@/types/api';
import { fmtDay } from './rentUi';

/**
 * Payments tenants reported from the tenant portal, waiting to be checked.
 * Confirming posts them to the ledger; rejecting tells the tenant why (both by SMS).
 * Renders nothing when there is nothing to review.
 */
export default function PaymentClaimsPanel() {
  const queryClient = useQueryClient();
  const { can } = useLandlordAccess();
  const { data } = useQuery({
    queryKey: ['payment-claims', 'PENDING'],
    queryFn: () => listPaymentClaims({ status: 'PENDING', limit: 20 }),
    enabled: can('ledger.view'),
    refetchInterval: 60_000,
  });

  const refresh = () => {
    for (const key of [['payment-claims'], ['leases'], ['lease'], ['statement'], ['ledger'], ['arrears'], ['rent-report']]) queryClient.invalidateQueries({ queryKey: key });
  };
  const confirm = useMutation({
    mutationFn: (c: RentPaymentClaim) => confirmPaymentClaim(c.id),
    onSuccess: (c) => { refresh(); notify('success', 'Payment confirmed', `${fmtKes(c.amount)} posted to ${c.tenant.name}'s statement.`); },
    onError: (err) => { refresh(); notify('error', 'Could not confirm', errorMessage(err)); },
  });
  const reject = useMutation({
    mutationFn: ({ c, reason }: { c: RentPaymentClaim; reason: string }) => rejectPaymentClaim(c.id, reason),
    onSuccess: (c) => { refresh(); notify('success', 'Payment rejected', `${c.tenant.name} has been told why by SMS.`); },
    onError: (err) => { refresh(); notify('error', 'Could not reject', errorMessage(err)); },
  });

  if (!data?.data.length) return null;
  const canReview = (c: RentPaymentClaim) => can(c.purpose === 'DEPOSIT' ? 'deposits.manage' : 'payments.record');

  const onConfirm = async (c: RentPaymentClaim) => {
    const ok = await confirmDialog({
      title: `Confirm ${fmtKes(c.amount)} from ${c.tenant.name}?`,
      text: c.method === 'MPESA'
        ? `Check that M-Pesa receipt ${c.reference} for ${fmtKes(c.amount)} is on your M-Pesa statement. It will be posted as ${c.purpose === 'DEPOSIT' ? 'a deposit received' : 'a rent payment'} dated ${fmtDay(c.paidOn)}.`
        : `Only confirm if you or your staff received ${fmtKes(c.amount)} in cash. It will be posted as ${c.purpose === 'DEPOSIT' ? 'a deposit received' : 'a rent payment'} dated ${fmtDay(c.paidOn)}.`,
      confirmLabel: 'Confirm and post',
    });
    if (ok) confirm.mutate(c);
  };
  const onReject = async (c: RentPaymentClaim) => {
    const reason = await promptDialog({
      title: `Reject ${c.tenant.name}'s payment?`,
      text: 'The tenant gets this reason by SMS.',
      inputLabel: 'Reason',
      placeholder: c.method === 'MPESA' ? 'e.g. Receipt not found on our M-Pesa statement' : 'e.g. No cash was received',
      confirmLabel: 'Reject payment',
      minLength: 3,
      maxLength: 300,
    });
    if (reason) reject.mutate({ c, reason });
  };
  const busyId = (confirm.isPending && confirm.variables?.id) || (reject.isPending && reject.variables?.c.id) || null;

  return (
    <section className="hd-card pc-panel">
      <div className="hd-card-head">
        <b><Inbox size={15} style={{ verticalAlign: -2 }} /> Payments to confirm <span className="pill pill-amber" style={{ marginLeft: 6 }}>{data.pending}</span></b>
        <small className="rn-muted">Reported by tenants · not on the books until you confirm</small>
      </div>
      <ul className="pc-list">
        {data.data.map((c) => (
          <li key={c.id} className="pc-row">
            <span className={`pc-ico ${c.method === 'MPESA' ? 'mpesa' : 'cash'}`}>{c.method === 'MPESA' ? <Smartphone size={16} /> : <Banknote size={16} />}</span>
            <span className="pc-main">
              <b>{c.tenant.name} · {fmtKes(c.amount)} {c.purpose === 'DEPOSIT' ? 'deposit' : 'rent'}</b>
              <small>
                {c.lease.unit.name}, {c.lease.property.name} · {c.method === 'MPESA' ? <>M-Pesa <span className="mono">{c.reference}</span></> : `Cash${c.reference ? ` · receipt ${c.reference}` : ''}`} · paid {fmtDay(c.paidOn)}
              </small>
              {c.note && <small className="pc-note">“{c.note}”</small>}
            </span>
            {canReview(c) ? (
              <span className="pc-actions">
                {busyId === c.id ? <AppLoader size={18} /> : (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReject(c)} disabled={!!busyId}><X size={14} /> Reject</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => onConfirm(c)} disabled={!!busyId}><Check size={14} /> Confirm</button>
                  </>
                )}
              </span>
            ) : (
              <small className="rn-muted">Needs someone who can record {c.purpose === 'DEPOSIT' ? 'deposits' : 'payments'}</small>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
