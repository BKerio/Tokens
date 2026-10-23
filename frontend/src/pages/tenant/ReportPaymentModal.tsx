import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, Coins, HandCoins, NotebookPen, PiggyBank, ReceiptText, Smartphone } from 'lucide-react';
import { reportPayment } from '@/api/rentals';
import { errorMessage } from '@/api/client';
import { notify } from '@/lib/alert';
import { fmtKes } from '@/lib/format';
import { nairobiTodayISO } from '@/lib/datetime';
import { AmountInput, ChoiceTiles, FormSheet, SheetField, SheetGrid, SheetNote, SheetSection } from '@/components/shared/FormSheet';
import type { RentClaimPurpose } from '@/types/api';

/** M-Pesa receipts are 10 letters/digits, e.g. QJK7XB2LMN (same check as the API). */
const RECEIPT_RE = /^[A-Z0-9]{10}$/;

export interface ReportableLease {
  id: string;
  code: string;
  rentAmount: number;
  depositAmount: number;
  unit: { name: string };
  property: { name: string };
  account: { balance: number; depositHeld: number };
}

/**
 * "I've paid": the tenant tells their landlord about an M-Pesa or cash payment
 * for rent or deposit. It reaches the statement once the landlord confirms it.
 */
export default function ReportPaymentModal({ lease, landlordName, onClose }: { lease: ReportableLease; landlordName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const depositDue = Math.max(0, lease.depositAmount - lease.account.depositHeld);
  const [purpose, setPurpose] = useState<RentClaimPurpose>('RENT');
  const [method, setMethod] = useState<'MPESA' | 'CASH'>('MPESA');
  const [amount, setAmount] = useState(lease.account.balance > 0 ? String(lease.account.balance) : '');
  const [paidOn, setPaidOn] = useState(nairobiTodayISO());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const value = Number(amount) || 0;
  const receipt = reference.trim().toUpperCase();
  const errors = {
    amount: tried && !(value > 0) ? 'Enter the amount you paid' : undefined,
    paidOn: tried && !paidOn ? 'Choose the date you paid' : undefined,
    reference: method !== 'MPESA' ? undefined
      : !receipt ? (tried ? 'Enter the receipt number from your M-Pesa SMS' : undefined)
        : tried && !RECEIPT_RE.test(receipt) ? 'A receipt number is 10 letters and numbers' : undefined,
  };
  const valid = value > 0 && !!paidOn && (method === 'CASH' || RECEIPT_RE.test(receipt));

  const save = useMutation({
    mutationFn: () => reportPayment(lease.id, {
      purpose, method, amount: value, paidOn, reference: receipt || undefined, note: note.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-overview'] });
      notify('success', 'Sent to your landlord', `${landlordName} will confirm it and it will then show on your statement.`);
      onClose();
    },
    onError: (err) => notify('error', 'Could not send', errorMessage(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (valid) save.mutate();
  };

  const pickPurpose = (p: RentClaimPurpose) => {
    setPurpose(p);
    // Pre-fill what's owed for the chosen purpose, unless the tenant already typed something else.
    const suggested = p === 'DEPOSIT' ? depositDue : lease.account.balance;
    if (!amount || Number(amount) === (p === 'DEPOSIT' ? lease.account.balance : depositDue)) setAmount(suggested > 0 ? String(suggested) : '');
  };

  const presets: { label: string; amount: number }[] = [];
  if (purpose === 'RENT') {
    if (lease.account.balance > 0) presets.push({ label: `What you owe · ${fmtKes(lease.account.balance)}`, amount: lease.account.balance });
    if (lease.rentAmount > 0 && lease.rentAmount !== lease.account.balance) presets.push({ label: `One period’s rent · ${fmtKes(lease.rentAmount)}`, amount: lease.rentAmount });
  } else if (depositDue > 0) {
    presets.push({ label: `Deposit due · ${fmtKes(depositDue)}`, amount: depositDue });
  }

  return (
    <FormSheet
      icon={HandCoins}
      title="I’ve paid"
      subtitle={`Tell ${landlordName} about a payment you made for ${lease.unit.name}. It shows on your statement once they confirm it.`}
      steps={[
        { id: 'what', title: 'What for', Icon: ReceiptText, done: true },
        { id: 'amount', title: 'Amount', Icon: Coins, done: value > 0 },
        { id: 'proof', title: 'Proof', Icon: NotebookPen, done: valid },
      ]}
      width={600}
      onClose={onClose}
      onSubmit={submit}
      busy={save.isPending}
      submitLabel="Send to landlord"
      meta={<><Coins size={15} /> <b>{value ? fmtKes(value) : 'No amount yet'}</b> · {purpose === 'DEPOSIT' ? 'deposit' : 'rent'}</>}
    >
      <SheetSection id="what">
        <div className="vf-field">
          <span className="vf-label">What was it for?</span>
          <ChoiceTiles
            value={purpose}
            onChange={pickPurpose}
            label="What was the payment for?"
            options={[
              { value: 'RENT', label: 'Rent', hint: 'Rent or other charges', Icon: ReceiptText },
              { value: 'DEPOSIT', label: 'Deposit', hint: depositDue > 0 ? `${fmtKes(depositDue)} still due` : 'Security deposit', Icon: PiggyBank },
            ]}
          />
        </div>
        <div className="vf-field">
          <span className="vf-label">How did you pay?</span>
          <ChoiceTiles
            value={method}
            onChange={setMethod}
            label="How did you pay?"
            options={[
              { value: 'MPESA', label: 'M-Pesa', hint: 'Paybill, till or send money', Icon: Smartphone },
              { value: 'CASH', label: 'Cash', hint: 'Handed to the landlord or caretaker', Icon: Banknote },
            ]}
          />
        </div>
      </SheetSection>

      <SheetSection id="amount">
        <SheetField error={errors.amount}>
          <AmountInput value={amount} onChange={setAmount} presets={presets} label="Amount paid" />
        </SheetField>
      </SheetSection>

      <SheetSection id="proof">
        <SheetGrid>
          {method === 'MPESA' ? (
            <SheetField label="M-Pesa receipt number" required hint="From your M-Pesa SMS, e.g. QJK7XB2LMN" error={errors.reference}>
              <input
                className="input mono"
                value={reference}
                maxLength={10}
                autoCapitalize="characters"
                placeholder="QJK7XB2LMN"
                onChange={(e) => setReference(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </SheetField>
          ) : (
            <SheetField label="Receipt number" aside="Optional" hint="If you were given a written receipt">
              <input className="input mono" value={reference} maxLength={30} onChange={(e) => setReference(e.target.value)} />
            </SheetField>
          )}
          <SheetField label="Date paid" required error={errors.paidOn}>
            <input className="input" type="date" value={paidOn} max={nairobiTodayISO()} onChange={(e) => setPaidOn(e.target.value)} />
          </SheetField>
        </SheetGrid>
        <SheetField label="Note" aside="Optional">
          <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={method === 'CASH' ? 'e.g. Paid to the caretaker, John' : 'e.g. Paid from my wife’s number'} />
        </SheetField>
        <SheetNote>
          {method === 'MPESA'
            ? 'Your landlord checks the receipt against their M-Pesa statement before it’s added. You’ll get an SMS when it’s confirmed.'
            : 'Your landlord confirms they received the cash before it’s added. You’ll get an SMS when it’s confirmed.'}
        </SheetNote>
      </SheetSection>
    </FormSheet>
  );
}
