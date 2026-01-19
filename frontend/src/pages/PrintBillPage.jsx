import { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode.react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Download, Mail, MessageSquare, Printer, Eye, ChevronLeft, ChevronRight, Edit, DollarSign, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { billAPI, paymentAPI } from '../services/api';
import { formatCurrency, formatDate } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import MarkPaymentModal from '../components/modals/MarkPaymentModal';
import PaymentHistoryPopup from '../components/modals/PaymentHistoryPopup';
import Modal from '../components/common/Modal';
import Dropdown from '../components/common/Dropdown';
import DatePicker from 'react-datepicker';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const PrintBillPage = () => {
  const location = useLocation();
  const printRef = useRef();
  const navigate = useNavigate();
  const { user } = useAuth();

  // States
  const [view, setView] = useState('list'); // 'list' or 'preview'
  const [bills, setBills] = useState([]);
  const [selectedBill, setSelectedBill] = useState(null);
  const [loading, setLoading] = useState(false);
  const [finalizingBill, setFinalizingBill] = useState(false);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalBills, setTotalBills] = useState(0);
  const billsPerPage = 25;
  
  // Filters
  const [filters, setFilters] = useState({
    status: '',
    payment_status: '',
    searchTerm: '',
    date_from: '',
    date_to: '',
    header_id: '',
    client_id: '',
    created_by: ''
  });
  
  // Modals
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const [selectedBillForPayment, setSelectedBillForPayment] = useState(null);

  useEffect(() => {
    if (location.state?.billNo) {
      handleSearchByNumber(location.state.billNo);
    } else {
      loadBills();
    }
  }, [currentPage, filters]);

  const loadBills = async () => {
    setLoading(true);
    try {
      const offset = (currentPage - 1) * billsPerPage;
      const params = {
        limit: billsPerPage,
        offset,
        ...(filters.status && { status: filters.status }),
        ...(filters.payment_status && { payment_status: filters.payment_status }),
        ...(filters.date_from && { date_from: filters.date_from }),
        ...(filters.date_to && { date_to: filters.date_to }),
        ...(filters.header_id && { header_id: filters.header_id }),
        ...(filters.client_id && { client_id: filters.client_id }),
        ...(filters.created_by && { created_by: filters.created_by })
      };
      
      const response = await billAPI.getAllBills(params);
      setBills(response.data.data);
      setTotalBills(response.data.count);
    } catch (error) {
      console.error('Failed to load bills:', error);
      toast.error('Failed to load bills');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchByNumber = async (billNo) => {
    setLoading(true);
    try {
      const response = await billAPI.getBillByNumber(billNo);
      setSelectedBill(response.data.data);
      setView('preview');
      toast.success('Bill loaded successfully');
    } catch (error) {
      console.error('Failed to fetch bill:', error);
      toast.error(error.response?.data?.message || 'Bill not found');
    } finally {
      setLoading(false);
    }
  };

  const handleViewBill = async (bill) => {
    setLoading(true);
    try {
      const response = await billAPI.getBillByNumber(bill.bill_no);
      setSelectedBill(response.data.data);
      setView('preview');
    } catch (error) {
      console.error('Failed to load bill:', error);
      toast.error('Failed to load bill');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToList = () => {
    setView('list');
    setSelectedBill(null);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    try {
      const loadingToast = toast.loading('Generating PDF...');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const element = printRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${selectedBill.bill_no}.pdf`);
      
      toast.dismiss(loadingToast);
      toast.success('PDF downloaded successfully');
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      toast.error('Failed to generate PDF');
    }
  };

  const handleSendEmail = async (e) => {
    e.preventDefault();
    
    try {
      await billAPI.sendEmail(selectedBill.id, { recipient_email: recipientEmail });
      toast.success('Email sent successfully');
      setShowEmailModal(false);
      setRecipientEmail('');
    } catch (error) {
      console.error('Failed to send email:', error);
      toast.error('Failed to send email');
    }
  };

  const handleWhatsAppShare = () => {
    const message = `Bill ${selectedBill.bill_no} - Total: ${formatCurrency(selectedBill.total_invoice_value)}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  };

  const handleFinalizeBill = async () => {
    if (!window.confirm('Are you sure you want to finalize this bill? This action cannot be undone.')) {
      return;
    }

    setFinalizingBill(true);
    try {
      await billAPI.finalizeBill(selectedBill.id);
      toast.success('Bill finalized successfully');
      const response = await billAPI.getBillByNumber(selectedBill.bill_no);
      setSelectedBill(response.data.data);
      loadBills(); // Refresh list
    } catch (error) {
      console.error('Failed to finalize bill:', error);
      toast.error(error.response?.data?.message || 'Failed to finalize bill');
    } finally {
      setFinalizingBill(false);
    }
  };

  const totalPages = Math.ceil(totalBills / billsPerPage);

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'FINALIZED', label: 'Finalized' },
    { value: 'SENT', label: 'Sent' },
    { value: 'PAID', label: 'Paid' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          {view === 'list' ? 'All Bills' : 'Bill Preview'}
        </h1>
        {view === 'preview' && (
          <button
            onClick={handleBackToList}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Back to List</span>
          </button>
        )}
      </div>

      {view === 'list' ? (
        <>
          {/* Search & Filters */}
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Filters</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Search by Bill Number
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={filters.searchTerm}
                      onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                      onKeyPress={(e) => e.key === 'Enter' && filters.searchTerm && handleSearchByNumber(filters.searchTerm)}
                      placeholder="e.g., INV-ABC-001"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <button
                      onClick={() => filters.searchTerm && handleSearchByNumber(filters.searchTerm)}
                      className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                    >
                      <Search className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Date From
                  </label>
                  <DatePicker
                    selected={filters.date_from ? new Date(filters.date_from) : null}
                    onChange={(date) => setFilters({ ...filters, date_from: date?.toISOString().split('T')[0] || '' })}
                    dateFormat="dd/MM/yyyy"
                    placeholderText="From date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    isClearable
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Date To
                  </label>
                  <DatePicker
                    selected={filters.date_to ? new Date(filters.date_to) : null}
                    onChange={(date) => setFilters({ ...filters, date_to: date?.toISOString().split('T')[0] || '' })}
                    dateFormat="dd/MM/yyyy"
                    placeholderText="To date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    isClearable
                  />
                </div>

                <Dropdown
                  label="Status"
                  value={filters.status}
                  onChange={(value) => {
                    setFilters({ ...filters, status: value });
                    setCurrentPage(1);
                  }}
                  options={statusOptions}
                />

                <Dropdown
                  label="Payment Status"
                  value={filters.payment_status}
                  onChange={(value) => {
                    setFilters({ ...filters, payment_status: value });
                    setCurrentPage(1);
                  }}
                  options={[
                    { value: '', label: 'All' },
                    { value: 'UNPAID', label: 'Unpaid' },
                    { value: 'PARTIAL', label: 'Partial' },
                    { value: 'PAID', label: 'Paid' }
                  ]}
                />
              </div>
              
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setFilters({
                      status: '',
                      payment_status: '',
                      searchTerm: '',
                      date_from: '',
                      date_to: '',
                      header_id: '',
                      client_id: '',
                      created_by: ''
                    });
                    setCurrentPage(1);
                  }}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Clear Filters
                </button>
                <button
                  onClick={() => {
                    setCurrentPage(1);
                    loadBills();
                  }}
                  className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  Apply Filters
                </button>
              </div>
                  <button
                    onClick={() => filters.searchTerm && handleSearchByNumber(filters.searchTerm)}
                    className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                  >
                    <Search className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <Dropdown
                label="Filter by Status"
                value={filters.status}
                onChange={(value) => {
                  setFilters({ ...filters, status: value });
                  setCurrentPage(1);
                }}
                options={statusOptions}
              />
            </div>
          </div>

          {/* Bills Table */}
          <div className="bg-white rounded-lg shadow">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="spinner"></div>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Bill No
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Company
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Due Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Created By
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Payment
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Paid
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Balance
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {bills.map((bill) => (
                      <tr key={bill.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {bill.bill_no}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {bill.company_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {formatDate(bill.bill_date)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {formatDate(bill.due_date)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {bill.created_by_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium text-right">
                          {formatCurrency(bill.total_invoice_value)}
                        </td>
<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium text-right">
                          {formatCurrency(bill.total_invoice_value)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              bill.status === 'DRAFT'
                                ? 'bg-yellow-100 text-yellow-800'
                                : bill.status === 'FINALIZED'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {bill.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-1">
                            <span
                              className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                bill.payment_status === 'PAID'
                                  ? 'bg-green-100 text-green-800'
                                  : bill.payment_status === 'PARTIAL'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {bill.payment_status || 'UNPAID'}
                            </span>
                            {bill.payment_status && bill.payment_status !== 'UNPAID' && (
                              <button
                                onClick={() => {
                                  setSelectedBillForPayment(bill);
                                  setShowPaymentHistory(true);
                                }}
                                className="text-blue-600 hover:text-blue-800"
                              >
                                <Info className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium text-right">
                          {formatCurrency(bill.total_paid || 0)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 font-medium text-right">
                          {formatCurrency((bill.total_invoice_value || 0) - (bill.total_paid || 0))}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center space-x-2">
                            <button
                              onClick={() => handleViewBill(bill)}
                              className="text-primary-600 hover:text-primary-900"
                              title="View Bill"
                            >
                              <Eye className="w-5 h-5" />
                            </button>
                            {user?.role === 'CA' && bill.payment_status !== 'PAID' && (
                              <button
                                onClick={() => {
                                  setSelectedBillForPayment(bill);
                                  setShowPaymentModal(true);
                                }}
                                className="text-green-600 hover:text-green-900"
                                title="Mark Payment"
                              >
                                <DollarSign className="w-5 h-5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {!loading && totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  Showing {(currentPage - 1) * billsPerPage + 1} to{' '}
                  {Math.min(currentPage * billsPerPage, totalBills)} of {totalBills} bills
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-4 py-2 text-sm font-medium text-gray-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        selectedBill && (
          <>
            {/* Action Buttons */}
            <div className="bg-white rounded-lg shadow p-4 mb-6 no-print">
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handlePrint}
                  className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print</span>
                </button>
                <button
                  onClick={handleDownloadPDF}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Save as PDF</span>
                </button>
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  <span>Send Email</span>
                </button>
                <button
                  onClick={handleWhatsAppShare}
                  className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Share on WhatsApp</span>
                </button>
                {selectedBill.status === 'DRAFT' && (
                  <button
                    onClick={handleFinalizeBill}
                    disabled={finalizingBill}
                    className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
                  >
                    <span>{finalizingBill ? 'Finalizing...' : 'Finalize Bill'}</span>
                  </button>
                )}
                {selectedBill.status === 'DRAFT' && (
                <button
                  onClick={() => navigate('/services-form', { state: { editBill: selectedBill } })}
                  className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  <span>Edit Bill</span>
                </button>
                )}
              </div>

                {user?.role === 'CA' && selectedBill.payment_status !== 'PAID' && (
                  <button
                    onClick={() => {
                      setSelectedBillForPayment(selectedBill);
                      setShowPaymentModal(true);
                    }}
                    className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>Mark Payment</span>
                  </button>
                )}
            </div>

            {/* Bill Preview */}
            <div ref={printRef} className="bg-white rounded-lg shadow p-8">
              {/* Header */}
              <div className="border-b-2 border-gray-300 pb-6 mb-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">
                      {selectedBill.company_name}
                    </h1>
                    <p className="text-gray-600 mt-2">{selectedBill.proprietor_name}</p>
                    <p className="text-sm text-gray-600 mt-2">
                      {selectedBill.address_line1}
                      {selectedBill.address_line2 && <>, {selectedBill.address_line2}</>}
                    </p>
                    <p className="text-sm text-gray-600">
                      {selectedBill.city}, {selectedBill.state} - {selectedBill.pincode}
                    </p>
                    <p className="text-sm text-gray-600 mt-2">
                      Phone: {selectedBill.phone} | Email: {selectedBill.email}
                    </p>
                    <p className="text-sm text-gray-600">
                      GSTIN: {selectedBill.gstin} | PAN: {selectedBill.pan}
                    </p>
                  </div>
                  <div className="text-right">
                    <h2 className="text-2xl font-bold text-primary-600">INVOICE</h2>
                    <span className={`no-print inline-block mt-2 px-3 py-1 text-xs font-semibold rounded-full ${
                      selectedBill.status === 'DRAFT' 
                        ? 'bg-yellow-100 text-yellow-800' 
                        : selectedBill.status === 'FINALIZED'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {selectedBill.status}
                    </span>
                    <p className="text-sm text-gray-600 mt-3">
                      Bill No: <span className="font-semibold">{selectedBill.bill_no}</span>
                    </p>
                    <p className="text-sm text-gray-600">
                      Date: <span className="font-semibold">{formatDate(selectedBill.bill_date)}</span>
                    </p>
                    <p className="text-sm text-gray-600">
                      Due Date: <span className="font-semibold">{formatDate(selectedBill.due_date)}</span>
                    </p>
                    <p className="text-sm text-gray-600">
                      FY: <span className="font-semibold">{selectedBill.financial_year}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Bill To Section - Client Info */}
              {selectedBill.client_name && (
                <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Bill To:</h3>
                  <p className="text-base font-semibold text-gray-900">{selectedBill.client_name}</p>
                  {selectedBill.client_contact && (
                    <p className="text-sm text-gray-600">Contact: {selectedBill.client_contact}</p>
                  )}
                  {selectedBill.client_phone && (
                    <p className="text-sm text-gray-600">Phone: {selectedBill.client_phone}</p>
                  )}
                  {selectedBill.client_email && ( 
                    <p className="text-sm text-gray-600">Email: {selectedBill.client_email}</p>
                  )}
                </div>
              )}

              {/* Services Table */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Services Provided</h3>
                <table className="w-full border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold">
                        Sr.
                      </th>
                      <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold">
                        Particulars
                      </th>
                      <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold">
                        Date
                      </th>
                      <th className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold">
                        Year
                      </th>
                      <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold">
                        Amount
                      </th>
                      <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold">
                        GST ({selectedBill.services[0]?.gst_rate}%)
                      </th>
                      <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedBill.services && selectedBill.services.length > 0 ? (
                      selectedBill.services.map((service, index) => (
                        <tr key={index}>
                          <td className="border border-gray-300 px-4 py-2 text-sm">
                            {service.sr_no}
                          </td>
                          <td className="border border-gray-300 px-4 py-2 text-sm">
                            {service.particulars_other || service.particulars_name}
                          </td>
                          <td className="border border-gray-300 px-4 py-2 text-sm">
                            {formatDate(service.service_date)}
                          </td>
                          <td className="border border-gray-300 px-4 py-2 text-sm">
                            {service.service_year}
                          </td>
                          <td className="border border-gray-300 px-4 py-2 text-sm text-right">
                            {formatCurrency(service.amount)}
                          </td>
                          <td className="border border-gray-300 px-4 py-2 text-sm text-right">
                            {formatCurrency(service.gst_amount)}
                          </td>
                          <td className="border border-gray-300 px-4 py-2 text-sm text-right font-semibold">
                            {formatCurrency(service.total_amount)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="8" className="border border-gray-300 px-4 py-4 text-center text-gray-500">
                          No services found
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50">
                      <td colSpan="4" className="border border-gray-300 px-4 py-2 text-right font-semibold">
                        Subtotal:
                      </td>
                      <td className="border border-gray-300 px-4 py-2 text-right font-semibold">
                        {formatCurrency(selectedBill.subtotal)}
                      </td>
                      <td className="border border-gray-300 px-4 py-2 text-right font-semibold">
                        {formatCurrency(selectedBill.gst_total)}
                      </td>
                      <td className="border border-gray-300 px-4 py-2 text-right font-semibold">
                        {formatCurrency(selectedBill.total_invoice_value)}
                      </td>
                    </tr>
                    <tr className="bg-primary-50">
                      <td colSpan="6" className="border border-gray-300 px-4 py-3 text-right text-lg font-bold">
                        Total Invoice Value:
                      </td>
                      <td className="border border-gray-300 px-4 py-3 text-right text-lg font-bold text-primary-600">
                        {formatCurrency(selectedBill.total_invoice_value)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Bank Details & QR Code */}
              <div className="border-t-2 border-gray-300 pt-6 mt-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Bank Details</h3>
                    <p className="text-sm text-gray-700">
                      <span className="font-semibold">Bank Name:</span> {selectedBill.bank_name}
                    </p>
                    <p className="text-sm text-gray-700">
                      <span className="font-semibold">Account Holder:</span> {selectedBill.account_holder_name}
                    </p>
                    <p className="text-sm text-gray-700">
                      <span className="font-semibold">Account Number:</span> {selectedBill.account_number}
                    </p>
                    <p className="text-sm text-gray-700">
                      <span className="font-semibold">IFSC Code:</span> {selectedBill.ifsc_code}
                    </p>
                    <p className="text-sm text-gray-700">
                      <span className="font-semibold">Branch:</span> {selectedBill.branch_name}
                    </p>
                    {selectedBill.upi_id && (
                      <p className="text-sm text-gray-700">
                        <span className="font-semibold">UPI ID:</span> {selectedBill.upi_id}
                      </p>
                    )}
                  </div>
                  {selectedBill.upi_id ? (
                    <div className="text-center">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Scan to Pay</p>
                      <QRCode
                        value={`upi://pay?pa=${selectedBill.upi_id}&pn=${encodeURIComponent(selectedBill.company_name)}&am=${selectedBill.total_invoice_value}&cu=INR&tn=${selectedBill.bill_no}`}
                        size={128}
                        level="M"
                        className="border-2 border-gray-300 p-2 rounded"
                      />
                      <p className="text-xs text-gray-500 mt-1">UPI: {selectedBill.upi_id}</p>
                    </div>
                  ) : selectedBill.qr_code_image ? (
                    <div className="text-center">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Scan to Pay</p>
                      <img
                        src={selectedBill.qr_code_image}
                        alt="Payment QR Code"
                        className="w-32 h-32 border-2 border-gray-300"
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Notes */}
              {selectedBill.notes && (
                <div className="mt-6 p-4 bg-yellow-50 rounded-lg">
                  <p className="text-sm font-semibold text-gray-700">Notes:</p>
                  <p className="text-sm text-gray-600 mt-1">{selectedBill.notes}</p>
                </div>
              )}

              {/* Payment Terms */}
              <div className="mt-6 text-center text-sm text-gray-600">
                <p>Payment Terms: {selectedBill.payment_term}</p>
                <p className="mt-2">Thank you for your business!</p>
              </div>

              {/* Footer */}
              <div className="mt-8 pt-4 border-t border-gray-300 text-center">
                <p className="text-xs text-gray-500">
                  This is a computer-generated invoice and does not require a signature.
                </p>
              </div>
            </div>
          </>
        )
      )}

      {/* Email Modal */}
      <Modal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        title="Send Bill via Email"
        size="sm"
      >
        <form onSubmit={handleSendEmail} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Recipient Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="client@example.com"
            />
          </div>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => setShowEmailModal(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Send Email
            </button>
          </div>
        </form>
      </Modal>

{/* Mark Payment Modal */}
      <MarkPaymentModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false);
          setSelectedBillForPayment(null);
        }}
        bill={selectedBillForPayment}
        onPaymentMarked={async (paymentData) => {
          try {
            await paymentAPI.markPayment({
              bill_id: selectedBillForPayment.id,
              ...paymentData,
              payment_date: paymentData.payment_date.toISOString().split('T')[0]
            });
            toast.success('Payment recorded successfully');
            setShowPaymentModal(false);
            setSelectedBillForPayment(null);
            loadBills(); // Reload list
            if (view === 'preview') {
              const response = await billAPI.getBillByNumber(selectedBill.bill_no);
              setSelectedBill(response.data.data);
            }
          } catch (error) {
            console.error('Failed to mark payment:', error);
            toast.error(error.response?.data?.message || 'Failed to mark payment');
          }
        }}
      />

      {/* Payment History Popup */}
      <PaymentHistoryPopup
        isOpen={showPaymentHistory}
        onClose={() => {
          setShowPaymentHistory(false);
          setSelectedBillForPayment(null);
        }}
        billId={selectedBillForPayment?.id}
        billNo={selectedBillForPayment?.bill_no}
        totalAmount={selectedBillForPayment?.total_invoice_value}
      />

    </div>
  );
};

export default PrintBillPage;