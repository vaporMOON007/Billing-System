import { useState, useEffect } from 'react';
import { X, IndianRupee } from 'lucide-react';
import DatePicker from 'react-datepicker';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/helpers';
import { masterAPI } from '../../services/api';

const MODE_STYLES = {
  NEFT:   'border-blue-600 bg-blue-600 text-white',
  UPI:    'border-purple-600 bg-purple-600 text-white',
  CHEQUE: 'border-orange-500 bg-orange-500 text-white',
  CASH:   'border-green-600 bg-green-600 text-white',
};

const EMPTY_FORM = (balance) => ({
  payment_date:           new Date(),
  amount_paid:            balance,
  payment_mode:           'NEFT',
  notes:                  '',
  cheque_no:              '',
  utr:                    '',
  cash_collected_by:      '',
  received_in_account_id: '',
});

const MarkPaymentModal = ({ isOpen, onClose, bill, onPaymentMarked }) => {
  const balance = parseFloat(bill?.total_invoice_value || 0) - parseFloat(bill?.total_paid || 0);

  const [formData, setFormData]       = useState(EMPTY_FORM(balance));
  const [loading, setLoading]         = useState(false);
  const [bankAccounts, setBankAccounts] = useState([]);

  // Reset form + fetch bank accounts whenever modal opens
  useEffect(() => {
    if (isOpen && bill) {
      const freshBalance = parseFloat(bill.total_invoice_value || 0) - parseFloat(bill.total_paid || 0);
      setFormData(EMPTY_FORM(freshBalance));

      masterAPI.getBankAccounts()
        .then(res => setBankAccounts(res.data.data || []))
        .catch(err => {
          console.error('Failed to load bank accounts:', err);
          toast.error('Could not load bank accounts');
          setBankAccounts([]);
        });
    }
  }, [isOpen, bill?.id]);

  const set = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.amount_paid <= 0) {
      toast.error('Payment amount must be greater than 0');
      return;
    }
    if (formData.amount_paid > balance) {
      toast.error(`Payment amount cannot exceed balance of ${formatCurrency(balance)}`);
      return;
    }
    setLoading(true);
    await onPaymentMarked(formData);
    setLoading(false);
  };

  if (!isOpen || !bill) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose} />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative bg-white rounded-lg shadow-xl w-full max-w-lg transform transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <IndianRupee className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900">Mark Payment</h3>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Bill Summary */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Bill Number:</span>
                <span className="font-semibold text-gray-900">{bill.bill_no}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total Invoice:</span>
                <span className="font-semibold text-gray-900">{formatCurrency(bill.total_invoice_value)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Already Paid:</span>
                <span className="font-semibold text-green-600">{formatCurrency(bill.total_paid || 0)}</span>
              </div>
              <div className="flex justify-between text-base pt-2 border-t border-gray-200">
                <span className="font-semibold text-gray-700">Balance Due:</span>
                <span className="font-bold text-red-600">{formatCurrency(balance)}</span>
              </div>
            </div>

            {/* Payment Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Date <span className="text-red-500">*</span>
              </label>
              <DatePicker
                selected={formData.payment_date}
                onChange={(date) => set('payment_date', date)}
                dateFormat="dd/MM/yyyy"
                maxDate={new Date()}
                showMonthDropdown showYearDropdown dropdownMode="select"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount Paying Now <span className="text-red-500">*</span>
              </label>
              <input
                type="number" step="0.01"
                value={formData.amount_paid}
                onChange={(e) => set('amount_paid', parseFloat(e.target.value) || 0)}
                max={balance}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                required
              />
              <div className="flex justify-center mt-3">
                <button
                  type="button"
                  onClick={() => set('amount_paid', balance)}
                  className="flex items-center gap-1.5 px-4 py-2 border-2 border-green-600 text-green-600 bg-white rounded-lg hover:bg-green-50 font-semibold text-sm transition-colors"
                >
                  <IndianRupee className="w-4 h-4" />
                  Mark Full Payment ({formatCurrency(balance)})
                </button>
              </div>
            </div>

            {/* Payment Mode */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Mode <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-4 gap-2">
                {['NEFT', 'UPI', 'CHEQUE', 'CASH'].map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => set('payment_mode', mode)}
                    className={`py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                      formData.payment_mode === mode
                        ? MODE_STYLES[mode]
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Reference Fields — always visible */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cheque No</label>
                <input
                  type="text"
                  value={formData.cheque_no}
                  onChange={(e) => set('cheque_no', e.target.value)}
                  placeholder="e.g. 012345"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">UTR</label>
                <input
                  type="text"
                  value={formData.utr}
                  onChange={(e) => set('utr', e.target.value)}
                  placeholder="e.g. HDFC12345678"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cash Collected By</label>
              <input
                type="text"
                value={formData.cash_collected_by}
                onChange={(e) => set('cash_collected_by', e.target.value)}
                placeholder="Name of person who collected cash"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
              />
            </div>

            {/* Received In Account dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Received In Account</label>
              <select
                value={formData.received_in_account_id}
                onChange={(e) => set('received_in_account_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm bg-white"
              >
                <option value="">— Select bank account —</option>
                {bankAccounts.length === 0 ? (
                  <option disabled>No bank accounts found — add them in Company Master</option>
                ) : (
                  bankAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.company_name} — {acc.nick_name || acc.bank_name} ...{String(acc.account_number || '').slice(-4)}{acc.is_primary ? ' (Primary)' : ''}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows="2"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Add any notes about this payment..."
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button" onClick={onClose}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit" disabled={loading}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Recording...' : 'Record Payment'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default MarkPaymentModal;
