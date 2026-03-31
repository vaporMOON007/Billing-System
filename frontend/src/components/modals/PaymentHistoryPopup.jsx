import { useEffect, useState } from 'react';
import { X, IndianRupee, Calendar, User, CreditCard, Hash, Banknote, Building2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate } from '../../utils/helpers';
import api from '../../services/api';

const PaymentHistoryPopup = ({
  isOpen,
  onClose,
  billId,
  billNo,
  totalAmount,
  writeoffAmount,
  writeoffDate,
  writeoffNotes,
}) => {
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
  const writtenOff = parseFloat(writeoffAmount || 0);
  const balance = parseFloat(totalAmount) - totalPaid - writtenOff;

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
                <IndianRupee className="w-6 h-6 text-blue-600" />
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
                {/* Summary cards */}
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
                    {writtenOff > 0 && (
                      <p className="text-xs text-orange-600 mt-1">
                        + {formatCurrency(writtenOff)} written off
                      </p>
                    )}
                  </div>
                  <div className={`rounded-lg p-4 ${balance <= 0 ? 'bg-gray-50' : 'bg-red-50'}`}>
                    <p className={`text-xs font-medium mb-1 ${balance <= 0 ? 'text-gray-500' : 'text-red-600'}`}>
                      Balance Due
                    </p>
                    <p className={`text-xl font-bold ${balance <= 0 ? 'text-gray-400 line-through' : 'text-red-900'}`}>
                      {formatCurrency(Math.max(0, balance))}
                    </p>
                    {balance <= 0 && writtenOff > 0 && (
                      <p className="text-xs text-orange-600 mt-1">Write-off applied</p>
                    )}
                  </div>
                </div>

                {/* Payment transactions */}
                {payments.length > 0 || writtenOff > 0 ? (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">
                      Transactions ({payments.length + (writtenOff > 0 ? 1 : 0)})
                    </h4>

                    {/* Regular payment entries */}
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
                              {payment.payment_mode && (
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                  payment.payment_mode === 'NEFT'   ? 'bg-blue-100 text-blue-700' :
                                  payment.payment_mode === 'UPI'    ? 'bg-purple-100 text-purple-700' :
                                  payment.payment_mode === 'CHEQUE' ? 'bg-orange-100 text-orange-700' :
                                                                      'bg-green-100 text-green-700'
                                }`}>
                                  {payment.payment_mode}
                                </span>
                              )}
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
                              {payment.utr && (
                                <div className="flex items-center space-x-2">
                                  <Hash className="w-4 h-4" />
                                  <span>UTR: {payment.utr}</span>
                                </div>
                              )}
                              {payment.cheque_no && (
                                <div className="flex items-center space-x-2">
                                  <CreditCard className="w-4 h-4" />
                                  <span>Cheque No: {payment.cheque_no}</span>
                                </div>
                              )}
                              {payment.cash_collected_by && (
                                <div className="flex items-center space-x-2">
                                  <Banknote className="w-4 h-4" />
                                  <span>Collected by: {payment.cash_collected_by}</span>
                                </div>
                              )}
                              {(payment.received_in_bank || payment.received_account_holder || payment.received_account_number) && (
                                <div className="flex items-start space-x-2">
                                  <Building2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                  <div className="text-sm">
                                    {payment.received_in_bank && (
                                      <div className="font-medium">{payment.received_in_bank}</div>
                                    )}
                                    {payment.received_account_holder && (
                                      <div className="text-gray-500">A/C Holder: {payment.received_account_holder}</div>
                                    )}
                                    {payment.received_account_number && (
                                      <div className="text-gray-500">A/C No: {payment.received_account_number}</div>
                                    )}
                                  </div>
                                </div>
                              )}
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

                    {/* Write-off entry */}
                    {writtenOff > 0 && (
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-semibold rounded">
                                Write-Off
                              </span>
                              <span className="text-lg font-bold text-orange-900">
                                {formatCurrency(writtenOff)}
                              </span>
                              <span className="text-xs text-orange-600">(Balance written off)</span>
                            </div>
                            <div className="space-y-1 text-sm text-orange-800">
                              {writeoffDate && (
                                <div className="flex items-center space-x-2">
                                  <Calendar className="w-4 h-4" />
                                  <span>{formatDate(writeoffDate)}</span>
                                </div>
                              )}
                              {writeoffNotes && (
                                <div className="mt-2 p-2 bg-white rounded border border-orange-200">
                                  <p className="text-xs text-orange-500">Reason:</p>
                                  <p className="text-sm text-orange-700">{writeoffNotes}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <IndianRupee className="w-16 h-16 text-gray-300 mx-auto mb-3" />
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
