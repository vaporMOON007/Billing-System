import { useState } from 'react';
import { X, DollarSign } from 'lucide-react';
import DatePicker from 'react-datepicker';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/helpers';

const MarkPaymentModal = ({ isOpen, onClose, bill, onPaymentMarked }) => {
  const balance = parseFloat(bill?.total_invoice_value || 0) - parseFloat(bill?.total_paid || 0);
  
  const [formData, setFormData] = useState({
    payment_date: new Date(),
    amount_paid: balance,
    notes: ''
  });
  
  const [loading, setLoading] = useState(false);

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

  const handleMarkFullPayment = () => {
    setFormData({
      ...formData,
      amount_paid: balance
    });
  };

  if (!isOpen || !bill) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative bg-white rounded-lg shadow-xl w-full max-w-md transform transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900">Mark Payment</h3>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Bill Summary */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Bill Number:</span>
                <span className="font-semibold text-gray-900">{bill.bill_no}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total Invoice:</span>
                <span className="font-semibold text-gray-900">
                  {formatCurrency(bill.total_invoice_value)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Already Paid:</span>
                <span className="font-semibold text-green-600">
                  {formatCurrency(bill.total_paid || 0)}
                </span>
              </div>
              <div className="flex justify-between text-base pt-2 border-t border-gray-200">
                <span className="font-semibold text-gray-700">Balance Due:</span>
                <span className="font-bold text-red-600">
                  {formatCurrency(balance)}
                </span>
              </div>
            </div>

            {/* Payment Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Date <span className="text-red-500">*</span>
              </label>
              <DatePicker
                selected={formData.payment_date}
                onChange={(date) => setFormData({ ...formData, payment_date: date })}
                dateFormat="dd/MM/yyyy"
                maxDate={new Date()}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                required
              />
            </div>

            {/* Amount Paid */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount Paying Now <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.amount_paid}
                onChange={(e) => setFormData({ ...formData, amount_paid: parseFloat(e.target.value) || 0 })}
                max={balance}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                required
              />
              {formData.amount_paid !== balance && (
                <button
                  type="button"
                  onClick={handleMarkFullPayment}
                  className="mt-2 text-sm text-green-600 hover:text-green-700 font-medium"
                >
                  Mark Full Payment ({formatCurrency(balance)})
                </button>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes (Optional)
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows="3"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Add any notes about this payment..."
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
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
