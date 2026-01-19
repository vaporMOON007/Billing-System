import { useEffect, useState } from 'react';
import { X, DollarSign, Calendar, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate } from '../../utils/helpers';
import api from '../../services/api';

const PaymentHistoryPopup = ({ isOpen, onClose, billId, billNo, totalAmount }) => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && billId) {
      loadPaymentHistory();
    }
  }, [isOpen, billId]);

  const loadPaymentHistory = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/payments/bill/${billId}`);
      setPayments(response.data.data);
    } catch (error) {
      console.error('Failed to load payment history:', error);
      toast.error('Failed to load payment history');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const totalPaid = payments.reduce((sum, p) => sum + parseFloat(p.amount_paid), 0);
  const balance = parseFloat(totalAmount) - totalPaid;

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
          className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl transform transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Payment History</h3>
                <p className="text-sm text-gray-500">Bill: {billNo}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="spinner"></div>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-xs text-blue-600 font-medium mb-1">Total Invoice</p>
                    <p className="text-xl font-bold text-blue-900">
                      {formatCurrency(totalAmount)}
                    </p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4">
                    <p className="text-xs text-green-600 font-medium mb-1">Total Paid</p>
                    <p className="text-xl font-bold text-green-900">
                      {formatCurrency(totalPaid)}
                    </p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4">
                    <p className="text-xs text-red-600 font-medium mb-1">Balance Due</p>
                    <p className="text-xl font-bold text-red-900">
                      {formatCurrency(balance)}
                    </p>
                  </div>
                </div>

                {/* Payment List */}
                {payments.length > 0 ? (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">
                      Payment Transactions ({payments.length})
                    </h4>
                    {payments.map((payment, index) => (
                      <div
                        key={payment.id}
                        className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded">
                                Payment {index + 1}
                              </span>
                              <span className="text-lg font-bold text-gray-900">
                                {formatCurrency(payment.amount_paid)}
                              </span>
                            </div>
                            
                            <div className="space-y-1 text-sm text-gray-600">
                              <div className="flex items-center space-x-2">
                                <Calendar className="w-4 h-4" />
                                <span>{formatDate(payment.payment_date)}</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <User className="w-4 h-4" />
                                <span>Recorded by: {payment.recorded_by_name || 'Unknown'}</span>
                              </div>
                              {payment.notes && (
                                <div className="mt-2 p-2 bg-white rounded border border-gray-200">
                                  <p className="text-xs text-gray-500">Note:</p>
                                  <p className="text-sm text-gray-700">{payment.notes}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <DollarSign className="w-16 h-16 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No payments recorded yet</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentHistoryPopup;
