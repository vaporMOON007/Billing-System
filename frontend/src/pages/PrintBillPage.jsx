import { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode.react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Download, Mail, MessageSquare, Printer, Eye, ChevronLeft, ChevronRight, Edit, IndianRupee, Info, AlertTriangle, AlertCircle, Trash2, GitMerge, GitBranch, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { billAPI, paymentAPI, masterAPI } from '../services/api';
import { formatCurrency, formatDate } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import MarkPaymentModal from '../components/modals/MarkPaymentModal';
import { SuccessCheckmark, PaymentAnimation, FinalizeAnimation } from '../components/common/SuccessAnimation';
import EmptyState from '../components/common/EmptyState';
import { TableSkeleton } from '../components/common/SkeletonLoader';
import PaymentHistoryPopup from '../components/modals/PaymentHistoryPopup';
import PrintPreviewModal from '../components/modals/PrintPreviewModal';
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
  
  // Filters — pre-populate from Reports page navigation if provided
  const [filters, setFilters] = useState(() => {
    const incoming = location.state?.filter || {};
    return {
      status:         incoming.status         || '',
      payment_status: incoming.payment_status || '',
      searchTerm:     '',
      date_from:      incoming.date_from      || '',
      date_to:        incoming.date_to        || '',
      header_id:      incoming.header_id      || '',
      client_id:      incoming.client_id      || '',
      created_by:     '',
      client_search:  ''
    };
  });

  // Only Finalized toggle — initialises from incoming navigation (e.g. from Reports page)
  const [onlyFinalized, setOnlyFinalized] = useState(() => {
    const incoming = location.state?.filter || {};
    return incoming.status === 'FINALIZED';
  });

  const handleOnlyFinalizedToggle = () => {
    const next = !onlyFinalized;
    setOnlyFinalized(next);
    setFilters(f => ({ ...f, status: next ? 'FINALIZED' : '' }));
    setCurrentPage(1);
  };
  
  // Modals
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const [selectedBillForPayment, setSelectedBillForPayment] = useState(null);

  // NEW: Finalize modal states
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [finalizeConfirmed, setFinalizeConfirmed] = useState(false);

  // NEW: Delete modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [billToDelete, setBillToDelete] = useState(null);

  // Quick finalize from list
  const [showQuickFinalizeModal, setShowQuickFinalizeModal] = useState(false);
  const [billToFinalize, setBillToFinalize] = useState(null);
  const [quickFinalizing, setQuickFinalizing] = useState(false);

  // Merge mode
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState([]); // array of bill ids
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeNotes, setMergeNotes] = useState('');
  const [merging, setMerging] = useState(false);
  const [headers, setHeaders] = useState([]);
  // Cross-company merge: header picker
  const [showHeaderPickModal, setShowHeaderPickModal] = useState(false);
  const [pickedHeaderId, setPickedHeaderId] = useState(null);

  // Unmerge
  const [showUnmergeModal, setShowUnmergeModal] = useState(false);
  const [billToUnmerge, setBillToUnmerge] = useState(null);
  const [unmerging, setUnmerging] = useState(false);
 
  // NEW: Animation states
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [showPaymentAnimation, setShowPaymentAnimation] = useState(false);
  const [showFinalizeAnimation, setShowFinalizeAnimation] = useState(false);
  const [animationAmount, setAnimationAmount] = useState('');

  // NEW: Print Preview
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewBill, setPreviewBill] = useState(null);

  // Override Payments modal (SUPERADMIN)
  const [showOverridePaymentsModal, setShowOverridePaymentsModal] = useState(false);
  const [overridePaymentsBill, setOverridePaymentsBill] = useState(null);
  const [overridePayments, setOverridePayments] = useState([]);
  const [overrideBankAccounts, setOverrideBankAccounts] = useState([]);
  const [savingPaymentId, setSavingPaymentId] = useState(null);
  const [editingPayments, setEditingPayments] = useState({});

  // Write-off states
  const [showWriteOffModal, setShowWriteOffModal] = useState(false);
  const [writeOffNotes, setWriteOffNotes] = useState('');
  const [writingOff, setWritingOff] = useState(false);

  useEffect(() => {
    masterAPI.getAllHeaders().then(r => setHeaders(r.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (location.state?.billId) {
      // Navigate came from bill creation — load the specific bill directly by ID
      handleLoadBillById(location.state.billId);
    } else if (location.state?.billNo) {
      // Legacy: navigate with billNo
      handleSearchByNumber(location.state.billNo);
    } else {
      // Normal load (also handles navigation from Reports with pre-set filters)
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
        ...(filters.created_by && { created_by: filters.created_by }),
        ...(filters.client_search && { client_search: filters.client_search })
      };

      const response = await billAPI.getAllBills(params);
      setBills(response.data.data);
      setTotalBills(response.data.pagination?.total || 0);
    } catch (error) {
      console.error('Failed to load bills:', error);
      toast.error('Failed to load bills');
    } finally {
      setLoading(false);
    }
  };

  // Load a specific bill directly by its DB id — used after bill creation navigation.
  // Falls back to loadBills() if the lookup fails so the list is never left blank.
  const handleLoadBillById = async (billId) => {
    setLoading(true);
    try {
      const response = await billAPI.getBillById(billId);
      setSelectedBill(response.data.data);
      setView('preview');
    } catch (error) {
      console.error('Failed to load created bill, falling back to list:', error);
      // Don't show an error toast — just silently load the bill list instead
      await loadBills();
    } finally {
      setLoading(false);
    }
  };

  const handleSearchByNumber = async (billNo) => {
    setLoading(true);
    try {
      // First find the bill by number to get its ID
      const searchResponse = await billAPI.getBillByNumber(billNo);
      const found = searchResponse.data.data;
      // Then fetch the full bill (with services array) by ID
      const fullResponse = await billAPI.getBillById(found.id);
      setSelectedBill(fullResponse.data.data);
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
      const response = await billAPI.getBillById(bill.id);
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
    loadBills();
  };

  // ── Override Payments (SUPERADMIN) ───────────────────────────────────────
  const handleOpenOverridePayments = async (bill) => {
    try {
      const [paymentsRes, bankRes] = await Promise.all([
        paymentAPI.getPaymentHistory(bill.id),
        masterAPI.getBankAccounts(),
      ]);
      const payments = paymentsRes.data.data || [];
      // Seed editable copy for each payment row
      const editMap = {};
      payments.forEach(p => {
        editMap[p.id] = {
          payment_date:          p.payment_date ? p.payment_date.split('T')[0] : '',
          amount_paid:           p.amount_paid,
          payment_mode:          p.payment_mode || 'NEFT',
          cheque_no:             p.cheque_no || '',
          utr:                   p.utr || '',
          cash_collected_by:     p.cash_collected_by || '',
          received_in_account_id: p.received_in_account_id || '',
          notes:                 p.notes || '',
        };
      });
      setOverridePayments(payments);
      setEditingPayments(editMap);
      setOverrideBankAccounts(bankRes.data.data || []);
      setOverridePaymentsBill(bill);
      setShowOverridePaymentsModal(true);
    } catch {
      toast.error('Failed to load payment details');
    }
  };

  const handleOverridePaymentFieldChange = (paymentId, field, value) => {
    setEditingPayments(prev => ({
      ...prev,
      [paymentId]: { ...prev[paymentId], [field]: value },
    }));
  };

  const handleSaveOverridePayment = async (paymentId) => {
    setSavingPaymentId(paymentId);
    try {
      const data = editingPayments[paymentId];
      await paymentAPI.updatePayment(paymentId, {
        payment_date:          data.payment_date || null,
        amount_paid:           parseFloat(data.amount_paid),
        payment_mode:          data.payment_mode,
        cheque_no:             data.cheque_no || null,
        utr:                   data.utr || null,
        cash_collected_by:     data.cash_collected_by || null,
        received_in_account_id: data.received_in_account_id || null,
        notes:                 data.notes || null,
      });
      toast.success('Payment updated successfully');
      // Refresh list
      const res = await paymentAPI.getPaymentHistory(overridePaymentsBill.id);
      const updated = res.data.data || [];
      const updatedMap = {};
      updated.forEach(p => {
        updatedMap[p.id] = {
          payment_date:          p.payment_date ? p.payment_date.split('T')[0] : '',
          amount_paid:           p.amount_paid,
          payment_mode:          p.payment_mode || 'NEFT',
          cheque_no:             p.cheque_no || '',
          utr:                   p.utr || '',
          cash_collected_by:     p.cash_collected_by || '',
          received_in_account_id: p.received_in_account_id || '',
          notes:                 p.notes || '',
        };
      });
      setOverridePayments(updated);
      setEditingPayments(updatedMap);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update payment');
    } finally {
      setSavingPaymentId(null);
    }
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

      const clientNameSafe = (selectedBill.client_name || 'Bill').replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
      const isDraft = selectedBill.status === 'DRAFT';
      const fileName = isDraft ? `${clientNameSafe} (DRAFT).pdf` : `${clientNameSafe}.pdf`;
      pdf.save(fileName);
      
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

  // Write-off triggered from inside the Override Payments modal
  const handleWriteOffFromModal = async () => {
    if (!overridePaymentsBill) return;
    setWritingOff(true);
    try {
      const res = await billAPI.writeOffBill(overridePaymentsBill.id, { notes: writeOffNotes });
      toast.success(res.data.message);
      setWriteOffNotes('');
      setShowOverridePaymentsModal(false);
      setOverridePaymentsBill(null);
      setOverridePayments([]);
      setEditingPayments({});
      loadBills();
      if (selectedBill && selectedBill.id === overridePaymentsBill.id) {
        const updated = await billAPI.getBillById(overridePaymentsBill.id);
        setSelectedBill(updated.data.data);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to apply write-off');
    } finally {
      setWritingOff(false);
    }
  };

  const handleWriteOff = async () => {
    setWritingOff(true);
    try {
      const res = await billAPI.writeOffBill(selectedBill.id, { notes: writeOffNotes });
      toast.success(res.data.message);
      setShowWriteOffModal(false);
      setWriteOffNotes('');
      loadBills();
      // Refresh selected bill
      const updated = await billAPI.getBillById(selectedBill.id);
      setSelectedBill(updated.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to apply write-off');
    } finally {
      setWritingOff(false);
    }
  };

  const handleWhatsAppShare = () => {
    const message = `Bill ${selectedBill.bill_no} - Total: ${formatCurrency(selectedBill.total_invoice_value)}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  };

  const handleFinalizeBill = async () => {
    setShowFinalizeModal(true);
  };

  const confirmFinalize = async () => {
    if (!finalizeConfirmed) {
      toast.error('Please confirm you understand this action is permanent');
      return;
    }

    setFinalizingBill(true);
    try {
      await billAPI.finalizeBill(selectedBill.id);
      
      setShowFinalizeAnimation(true);
      
      setTimeout(() => {
        toast.success('Bill finalized successfully');
        setShowFinalizeAnimation(false);
      }, 1200);
      
      const response = await billAPI.getBillById(selectedBill.id);
      setSelectedBill(response.data.data);
      loadBills();
      setShowFinalizeModal(false);
      setFinalizeConfirmed(false);
    } catch (error) {
      console.error('Failed to finalize bill:', error);
      toast.error(error.response?.data?.message || 'Failed to finalize bill');
    } finally {
      setFinalizingBill(false);
    }
  };

  const totalPages = Math.ceil(totalBills / billsPerPage);

  // Clear filters handler
  const handleClearFilters = () => {
    setOnlyFinalized(false);
    setFilters({
      status: '',
      payment_status: '',
      searchTerm: '',
      date_from: '',
      date_to: '',
      header_id: '',
      client_id: '',
      created_by: '',
      client_search: ''
    });
    setCurrentPage(1);
  };

  // NEW: Delete bill handlers
  const handleDeleteBill = (bill) => {
    setBillToDelete(bill);
    setShowDeleteModal(true);
    setDeleteConfirmText('');
  };

  const confirmDelete = async () => {
    const confirmKey = billToDelete.bill_no || 'DELETE';
    if (deleteConfirmText !== confirmKey) {
      toast.error(billToDelete.bill_no
        ? 'Bill number does not match. Please type the exact bill number.'
        : 'Please type DELETE to confirm.');
      return;
    }

    try {
      await billAPI.deleteBill(billToDelete.id);
      toast.success('Bill deleted successfully');
      setShowDeleteModal(false);
      setBillToDelete(null);
      setDeleteConfirmText('');
      loadBills();
      if (view === 'preview' && selectedBill?.id === billToDelete.id) {
        setView('list');
        setSelectedBill(null);
      }
    } catch (error) {
      console.error('Failed to delete bill:', error);
      toast.error(error.response?.data?.message || 'Failed to delete bill');
    }
  };

  // Quick finalize from bill list
  const handleQuickFinalize = (bill) => {
    setBillToFinalize(bill);
    setShowQuickFinalizeModal(true);
  };

  const confirmQuickFinalize = async () => {
    setQuickFinalizing(true);
    try {
      await billAPI.finalizeBill(billToFinalize.id);
      setShowFinalizeAnimation(true);
      setTimeout(() => setShowFinalizeAnimation(false), 1200);
      toast.success(`Bill ${billToFinalize.bill_no} finalized successfully`);
      setShowQuickFinalizeModal(false);
      setBillToFinalize(null);
      loadBills();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to finalize bill');
    } finally {
      setQuickFinalizing(false);
    }
  };

  // NEW: Print preview handlers — fetch full bill (with services) before opening modal
  const handleShowPrintPreview = async (bill) => {
    setLoading(true);
    try {
      const response = await billAPI.getBillById(bill.id);
      setPreviewBill(response.data.data);
      setShowPrintPreview(true);
    } catch (error) {
      console.error('Failed to load bill preview:', error);
      toast.error('Failed to load bill preview');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadFromPreview = async () => {
    try {
      const response = await billAPI.downloadBill(previewBill.id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const clientNameSafe2 = (previewBill.client_name || 'Bill').replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
      const isDraft2 = previewBill.status === 'DRAFT';
      link.setAttribute('download', isDraft2 ? `${clientNameSafe2} (DRAFT).pdf` : `${clientNameSafe2}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Bill downloaded successfully');
    } catch (error) {
      console.error('Failed to download bill:', error);
      toast.error('Failed to download bill');
    }
  };

  // ── Merge helpers ────────────────────────────────────────────────────────
  const toggleMergeMode = () => {
    setMergeMode(v => !v);
    setSelectedForMerge([]);
  };

  const toggleSelectForMerge = (bill) => {
    setSelectedForMerge(prev =>
      prev.includes(bill.id) ? prev.filter(id => id !== bill.id) : [...prev, bill.id]
    );
  };

  // All selected bills must be DRAFT — validate live
  const selectedBillObjects = bills.filter(b => selectedForMerge.includes(b.id));
  const mergeHeaderIds  = [...new Set(selectedBillObjects.map(b => b.header_id))];
  const mergeClientIds  = [...new Set(selectedBillObjects.map(b => b.client_id).filter(Boolean))];
  const sameHeader      = mergeHeaderIds.length === 1;
  const sameClient      = mergeClientIds.length === 1;
  // Valid = 2+ bills AND (same header OR same client with override)
  const crossCompany    = selectedForMerge.length >= 2 && !sameHeader && sameClient;
  const mergeValid      = selectedForMerge.length >= 2 && (sameHeader || sameClient);
  // Unique headers involved (for the picker modal)
  const mergeHeaderOptions = mergeHeaderIds.map(hid => ({
    id: hid,
    name: headers.find(h => h.id === hid)?.company_name
       || selectedBillObjects.find(b => b.header_id === hid)?.company_name
       || `Header #${hid}`,
  }));
  const mergeCompanyName = sameHeader
    ? (headers.find(h => h.id === mergeHeaderIds[0])?.company_name || selectedBillObjects[0]?.company_name || '')
    : '';

  const handleConfirmMerge = async () => {
    setMerging(true);
    try {
      const payload = { bill_ids: selectedForMerge, notes: mergeNotes || null };
      if (crossCompany && pickedHeaderId) payload.override_header_id = pickedHeaderId;
      const res = await billAPI.mergeBills(payload);
      toast.success(res.data.message);
      setShowMergeModal(false);
      setMergeMode(false);
      setSelectedForMerge([]);
      setMergeNotes('');
      setPickedHeaderId(null);
      loadBills();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to merge bills');
    } finally {
      setMerging(false);
    }
  };

  // Opens the header picker first (cross-company), then merge modal after pick
  const handleMergeButtonClick = () => {
    if (crossCompany) {
      setPickedHeaderId(null);
      setShowHeaderPickModal(true);
    } else {
      setShowMergeModal(true);
    }
  };

  const handleHeaderPickConfirm = () => {
    if (!pickedHeaderId) return;
    setShowHeaderPickModal(false);
    setShowMergeModal(true);
  };

  const handleUnmerge = (bill) => {
    setBillToUnmerge(bill);
    setShowUnmergeModal(true);
  };

  const confirmUnmerge = async () => {
    setUnmerging(true);
    try {
      const res = await billAPI.unmergeBill(billToUnmerge.id);
      toast.success(res.data.message);
      setShowUnmergeModal(false);
      setBillToUnmerge(null);
      if (view === 'preview') { setView('list'); setSelectedBill(null); }
      loadBills();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to unmerge');
    } finally {
      setUnmerging(false);
    }
  };

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'FINALIZED', label: 'Finalized' },
    { value: 'ABSORBED', label: 'Absorbed (merged)' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          {view === 'list' ? 'All Bills' : 'Bill Preview'}
        </h1>
        <div className="flex items-center gap-3">
          {view === 'list' && ['CA', 'SUPERADMIN'].includes(user?.role) && (
            <button
              onClick={toggleMergeMode}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mergeMode
                  ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <GitMerge className="w-4 h-4" />
              {mergeMode ? 'Cancel Merge' : 'Merge Bills'}
            </button>
          )}
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
      </div>

      {/* Merge action bar — appears when bills are selected in merge mode */}
      {mergeMode && (
        <div className={`mb-4 rounded-xl border p-4 flex items-center justify-between transition-all ${
          selectedForMerge.length > 0 ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className="flex items-center gap-3">
            <GitMerge className={`w-5 h-5 ${selectedForMerge.length > 0 ? 'text-indigo-600' : 'text-gray-400'}`} />
            <div>
              <p className="text-sm font-medium text-gray-800">
                {selectedForMerge.length === 0
                  ? 'Select 2 or more DRAFT bills from the same company to merge'
                  : `${selectedForMerge.length} bill${selectedForMerge.length > 1 ? 's' : ''} selected`
                }
              </p>
              {selectedForMerge.length > 0 && !mergeValid && !sameClient && mergeHeaderIds.length > 1 && (
                <p className="text-xs text-red-500 mt-0.5">Selected bills belong to different clients and cannot be merged</p>
              )}
              {selectedForMerge.length > 0 && crossCompany && (
                <p className="text-xs text-amber-600 mt-0.5">
                  Same client, different companies — you'll choose which company header to use
                </p>
              )}
              {selectedForMerge.length > 0 && mergeValid && sameHeader && (
                <p className="text-xs text-indigo-600 mt-0.5">Company: {mergeCompanyName}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleMergeButtonClick}
            disabled={!mergeValid}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            <GitMerge className="w-4 h-4" />
            Merge {selectedForMerge.length} Bills
          </button>
        </div>
      )}

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
                showMonthDropdown
                showYearDropdown
                dropdownMode="select"
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
                showMonthDropdown
                showYearDropdown
                dropdownMode="select"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                isClearable
              />
            </div>

            <Dropdown
              label="Status"
              value={filters.status}
              onChange={(value) => {
                setFilters(f => ({ ...f, status: value }));
                setOnlyFinalized(value === 'FINALIZED');
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Search by Client</label>
              <input
                type="text"
                value={filters.client_search || ''}
                onChange={(e) => setFilters({ ...filters, client_search: e.target.value })}
                placeholder="Client name..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            {/* Only Finalized toggle */}
            <button
              type="button"
              onClick={handleOnlyFinalizedToggle}
              className={`flex items-center gap-2.5 px-4 py-2 rounded-lg border-2 font-semibold text-sm transition-all select-none ${
                onlyFinalized
                  ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
                  : 'bg-white border-gray-300 text-gray-600 hover:border-primary-500 hover:text-primary-600'
              }`}
            >
              <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors flex-shrink-0 ${onlyFinalized ? 'bg-white/30' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${onlyFinalized ? 'translate-x-4' : 'translate-x-0'}`} />
              </span>
              Only Finalized
            </button>
            <div className="flex space-x-3">
              <button
                onClick={handleClearFilters}
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
          </div>
        </div>
          

          {/* Bills Table */}
          <div className="bg-white rounded-lg shadow">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    {mergeMode && (
                      <th className="px-3 py-2.5 w-8" />
                    )}
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase w-36">
                      Bill No
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase w-32">
                      Company
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase w-32">
                      Client
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase w-24">
                      Date
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase w-24">
                      Due Date
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase w-28">
                      By
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase w-28">
                      Amount
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase w-24">
                      Status
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase w-24">
                      Payment
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase w-24">
                      Paid
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase w-24">
                      Balance
                    </th>
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan="11" className="p-0">
                        <TableSkeleton rows={8} columns={11} />
                      </td>
                    </tr>
                  ) : bills.length === 0 ? (
                    <tr>
                      <td colSpan="11" className="p-0">
                        {filters.searchTerm || filters.status || filters.payment_status || filters.date_from || filters.date_to ? (
                          <EmptyState
                            type="filtered"
                            onAction={handleClearFilters}
                          />
                        ) : (
                          <EmptyState
                            type="noBills"
                            actionLabel="Create First Bill"
                            onAction={() => navigate('/services-form')}
                          />
                        )}
                      </td>
                    </tr>
                  ) : (
                    bills.map((bill) => {
                      const isAbsorbed = bill.status === 'ABSORBED';
                      const isMergedDraft = !isAbsorbed && bill.status === 'DRAFT' && bill.is_merged;
                      const isSelectedForMerge = selectedForMerge.includes(bill.id);
                      return (
                      <tr key={bill.id} className={`hover:bg-gray-50 ${isSelectedForMerge ? 'bg-indigo-50' : ''} ${isAbsorbed ? 'opacity-60' : ''}`}>
                        {mergeMode && (
                          <td className="px-3 py-2">
                            {bill.status === 'DRAFT' && (
                              <input
                                type="checkbox"
                                checked={isSelectedForMerge}
                                onChange={() => toggleSelectForMerge(bill)}
                                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2 whitespace-nowrap text-xs font-medium text-gray-900">
                          <div className="flex items-center gap-1.5">
                            {bill.bill_no || <span className="text-gray-400 italic font-mono">{bill.display_ref || `DRAFT-${bill.id}`}</span>}
                            {isMergedDraft && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-semibold rounded-full">
                                <GitMerge className="w-2.5 h-2.5" /> Merged
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-[128px]">
                          <div className="truncate" title={bill.company_name}>{bill.company_name}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-[128px]">
                          <div className="truncate" title={bill.client_name}>{bill.client_name || <span className="text-gray-300">—</span>}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                          {formatDate(bill.bill_date)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                          {formatDate(bill.due_date)}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-[112px]">
                          <div className="truncate" title={bill.created_by_name}>{bill.created_by_name}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900 font-medium text-right">
                          {formatCurrency(bill.total_invoice_value)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              bill.status === 'DRAFT'
                                ? 'bg-yellow-100 text-yellow-800'
                                : bill.status === 'FINALIZED'
                                ? 'bg-green-100 text-green-800'
                                : bill.status === 'ABSORBED'
                                ? 'bg-gray-100 text-gray-500'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {bill.status === 'ABSORBED' ? 'Absorbed' : bill.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center space-x-1">
                            <span
                              className={`px-2 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${
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
                                <Info className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-green-600 font-medium text-right">
                          {formatCurrency(bill.total_paid || 0)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-red-600 font-medium text-right">
                          {formatCurrency(Math.max(0, (bill.total_invoice_value || 0) - (bill.total_paid || 0) - parseFloat(bill.writeoff_amount || 0)))}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {/* Preview + Delete icons */}
                            <button
                              onClick={() => handleViewBill(bill)}
                              className="text-primary-600 hover:text-primary-900"
                              title="View Bill"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {['CA', 'SUPERADMIN'].includes(user?.role) && (
                              <button
                                onClick={() => handleDeleteBill(bill)}
                                className="text-red-500 hover:text-red-700"
                                title="Delete Bill"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            {/* Finalize button — only for DRAFT bills */}
                            {['CA', 'SUPERADMIN'].includes(user?.role) && bill.status === 'DRAFT' && (
                              <button
                                onClick={() => handleQuickFinalize(bill)}
                                className="px-2 py-1 bg-orange-500 text-white text-xs font-semibold rounded hover:bg-orange-600 transition-colors"
                                title="Finalize Bill"
                              >
                                Finalize
                              </button>
                            )}
                            {/* Mark Payment — always shown for FINALIZED bills; greyed out when already paid */}
                            {['CA', 'SUPERADMIN'].includes(user?.role) && bill.status === 'FINALIZED' && (
                              <button
                                onClick={() => {
                                  if (bill.payment_status !== 'PAID') {
                                    setSelectedBillForPayment(bill);
                                    setShowPaymentModal(true);
                                  }
                                }}
                                disabled={bill.payment_status === 'PAID'}
                                className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded transition-colors ${
                                  bill.payment_status === 'PAID'
                                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    : 'bg-green-600 text-white hover:bg-green-700'
                                }`}
                                title={bill.payment_status === 'PAID' ? 'Already fully paid' : 'Mark Payment'}
                              >
                                <IndianRupee className="w-3 h-3" />
                                <span>Mark Payment</span>
                              </button>
                            )}
                            {/* Unmerge — only for DRAFT bills that are an actual merge result */}
                            {['CA', 'SUPERADMIN'].includes(user?.role) && bill.status === 'DRAFT' && bill.is_merged && (
                              <button
                                onClick={() => handleUnmerge(bill)}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
                                title="Unmerge — restore source bills"
                              >
                                <GitBranch className="w-3 h-3" />
                                Unmerge
                              </button>
                            )}
                            {/* Override Edit — SUPERADMIN only, for finalized/paid bills */}
                            {user?.role === 'SUPERADMIN' && (bill.status === 'FINALIZED' || bill.status === 'PAID') && (
                              <button
                                onClick={async () => {
                                  try {
                                    const res = await billAPI.getBillById(bill.id);
                                    navigate('/services-form', { state: { editBill: res.data.data, overrideMode: true } });
                                  } catch {
                                    toast.error('Failed to load bill details');
                                  }
                                }}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                                title="Override Edit (SUPERADMIN)"
                              >
                                <Edit className="w-3 h-3" />
                                Override
                              </button>
                            )}
                            {/* Override Payments — SUPERADMIN only, for finalized/paid bills */}
                            {user?.role === 'SUPERADMIN' && (bill.status === 'FINALIZED' || bill.status === 'PAID') && (
                              <button
                                onClick={() => handleOpenOverridePayments(bill)}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                                title="Override Payments (SUPERADMIN)"
                              >
                                <IndianRupee className="w-3 h-3" />
                                Payments
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
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
            {/* Merge info banner */}
            {selectedBill.merged_from && selectedBill.merged_from.length > 0 && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4 no-print flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <GitMerge className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-indigo-800">Merged Bill</p>
                    <p className="text-xs text-indigo-600">
                      Created by merging: {selectedBill.merged_from.map(s => s.bill_no || s.display_ref || `DRAFT-${s.id}`).join(', ')}
                    </p>
                  </div>
                </div>
                {selectedBill.status === 'DRAFT' && ['CA', 'SUPERADMIN'].includes(user?.role) && (
                  <button
                    onClick={() => handleUnmerge(selectedBill)}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-300 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors"
                  >
                    <GitBranch className="w-4 h-4" />
                    Unmerge
                  </button>
                )}
              </div>
            )}
            {selectedBill.absorbed_into && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 no-print flex items-center gap-3">
                <Info className="w-5 h-5 text-gray-500 flex-shrink-0" />
                <p className="text-sm text-gray-600">
                  This bill was <span className="font-semibold">absorbed</span> into merged bill{' '}
                  <span className="font-mono font-semibold text-gray-800">
                    {selectedBill.absorbed_into.bill_no || selectedBill.absorbed_into.display_ref || `DRAFT-${selectedBill.absorbed_into.id}`}
                  </span>
                </p>
              </div>
            )}

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
                {/* Override Edit — SUPERADMIN only, for finalized/paid bills */}
                {user?.role === 'SUPERADMIN' && (selectedBill.status === 'FINALIZED' || selectedBill.status === 'PAID') && (
                <button
                  onClick={async () => {
                    try {
                      const res = await billAPI.getBillById(selectedBill.id);
                      navigate('/services-form', { state: { editBill: res.data.data, overrideMode: true } });
                    } catch {
                      toast.error('Failed to load bill details');
                    }
                  }}
                  className="flex items-center space-x-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  <span>Override Edit</span>
                </button>
                )}
                {/* Override Payments — SUPERADMIN only, for finalized/paid bills */}
                {user?.role === 'SUPERADMIN' && (selectedBill.status === 'FINALIZED' || selectedBill.status === 'PAID') && (
                <button
                  onClick={() => handleOpenOverridePayments(selectedBill)}
                  className="flex items-center space-x-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                >
                  <IndianRupee className="w-4 h-4" />
                  <span>Override Payments</span>
                </button>
                )}
                {['CA', 'SUPERADMIN'].includes(user?.role) && selectedBill.status === 'FINALIZED' && (
                  <button
                    onClick={() => {
                      if (selectedBill.payment_status !== 'PAID') {
                        setSelectedBillForPayment(selectedBill);
                        setShowPaymentModal(true);
                      }
                    }}
                    disabled={selectedBill.payment_status === 'PAID'}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                      selectedBill.payment_status === 'PAID'
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                    title={selectedBill.payment_status === 'PAID' ? 'Already fully paid' : 'Mark Payment'}
                  >
                    <IndianRupee className="w-4 h-4" />
                    <span>{selectedBill.payment_status === 'PAID' ? 'Fully Paid ✓' : 'Mark Payment'}</span>
                  </button>
                )}
                {user?.role === 'SUPERADMIN' && selectedBill.status === 'FINALIZED' && selectedBill.payment_status === 'PARTIAL' && parseFloat(selectedBill.writeoff_amount || 0) === 0 && (
                  <button
                    onClick={() => setShowWriteOffModal(true)}
                    className="flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
                  >
                    <span>Write Off Balance</span>
                  </button>
                )}
              </div>
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
                      {selectedBill.header_address_line1 || selectedBill.address_line1}
                      {(selectedBill.header_address_line2 || selectedBill.address_line2) && <>, {selectedBill.header_address_line2 || selectedBill.address_line2}</>}
                    </p>
                    <p className="text-sm text-gray-600">
                      {selectedBill.header_city || selectedBill.city}, {selectedBill.header_state || selectedBill.state} - {selectedBill.header_pincode || selectedBill.pincode}
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

              {/* Write-Off Badge */}
              {selectedBill.writeoff_amount > 0 && (
                <div className="mb-4 bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center gap-2">
                  <span className="text-sm font-semibold text-orange-800">Write-Off Applied:</span>
                  <span className="text-sm text-orange-700">₹{parseFloat(selectedBill.writeoff_amount).toFixed(2)} written off on {selectedBill.writeoff_date ? new Date(selectedBill.writeoff_date).toLocaleDateString('en-IN') : ''}</span>
                  {selectedBill.writeoff_notes && <span className="text-xs text-orange-600">— {selectedBill.writeoff_notes}</span>}
                </div>
              )}

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
                  {selectedBill.client_gstin && (
                    <p className="text-sm text-gray-600">GSTIN: <span className="font-mono">{selectedBill.client_gstin}</span></p>
                  )}
                  {selectedBill.client_pan && (
                    <p className="text-sm text-gray-600">PAN: <span className="font-mono">{selectedBill.client_pan}</span></p>
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
                        GST Rate
                      </th>
                      <th className="border border-gray-300 px-4 py-2 text-right text-sm font-semibold">
                        GST Amount
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
                            <div>{service.particulars_other || service.service_name}</div>
                            {service.description && (
                              <div className="text-xs text-gray-500 italic mt-0.5">{service.description}</div>
                            )}
                          </td>
                          <td className="border border-gray-300 px-4 py-2 text-sm">
                            {formatDate(service.service_date)}
                          </td>
                          <td className="border border-gray-300 px-4 py-2 text-sm">
                            {service.service_year
                              ? /^\d{4}$/.test(service.service_year)
                                ? `${parseInt(service.service_year) - 1}-${String(service.service_year).slice(-2)}`
                                : service.service_year
                              : '—'}
                          </td>
                          <td className="border border-gray-300 px-4 py-2 text-sm text-right">
                            {formatCurrency(service.amount)}
                          </td>
                          <td className="border border-gray-300 px-4 py-2 text-sm text-right">
                            {service.rate_percentage != null ? `${service.rate_percentage}%` : '—'}
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
                        {/* GST Rate col — no aggregate */}
                      </td>
                      <td className="border border-gray-300 px-4 py-2 text-right font-semibold">
                        {formatCurrency(selectedBill.gst_total)}
                      </td>
                      <td className="border border-gray-300 px-4 py-2 text-right font-semibold">
                        {formatCurrency(selectedBill.total_invoice_value)}
                      </td>
                    </tr>
                    <tr className="bg-primary-50">
                      <td colSpan="7" className="border border-gray-300 px-4 py-3 text-right text-lg font-bold">
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
                        value={`upi://pay?pa=${selectedBill.upi_id}&pn=${encodeURIComponent(selectedBill.company_name)}&am=${selectedBill.total_invoice_value}&cu=INR&tn=${encodeURIComponent(selectedBill.bill_no || '')}`}
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
                {selectedBill.payment_term && (
                  <p>Payment Terms: {selectedBill.payment_term}</p>
                )}
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
            
            // NEW: Show animation
            setAnimationAmount(formatCurrency(paymentData.amount_paid));
            setShowPaymentAnimation(true);
            
            setTimeout(() => {
              toast.success('Payment recorded successfully');
              setShowPaymentAnimation(false);
            }, 1500);
            
            setShowPaymentModal(false);
            loadBills();
            
            if (selectedBill && selectedBill.id === selectedBillForPayment.id) {
              const response = await billAPI.getBillById(selectedBill.id);
              setSelectedBill(response.data.data);
            }
            
            setSelectedBillForPayment(null);
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
        writeoffAmount={selectedBillForPayment?.writeoff_amount}
        writeoffDate={selectedBillForPayment?.writeoff_date}
        writeoffNotes={selectedBillForPayment?.writeoff_notes}
      />

      {/* Print Preview Modal */}
      <PrintPreviewModal
        isOpen={showPrintPreview}
        onClose={() => {
          setShowPrintPreview(false);
          setPreviewBill(null);
        }}
        bill={previewBill}
        onDownload={handleDownloadFromPreview}
        onEmail={() => {
          setShowPrintPreview(false);
          setRecipientEmail(previewBill?.client_email || '');
          setShowEmailModal(true);
        }}
      />

      {/* Quick Finalize Modal (from bill list) */}
      <Modal
        isOpen={showQuickFinalizeModal}
        onClose={() => {
          setShowQuickFinalizeModal(false);
          setBillToFinalize(null);
        }}
        title="Finalize Bill"
        size="sm"
      >
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-yellow-900">This action cannot be undone</p>
                <p className="text-sm text-yellow-700 mt-1">
                  Once finalized, bill <span className="font-bold">{billToFinalize?.bill_no}</span> cannot be edited or deleted.
                  After this you can record payments against it.
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button
              onClick={() => {
                setShowQuickFinalizeModal(false);
                setBillToFinalize(null);
              }}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmQuickFinalize}
              disabled={quickFinalizing}
              className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {quickFinalizing ? 'Finalizing...' : 'Yes, Finalize'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Finalize Confirmation Modal */}
      <Modal
        isOpen={showFinalizeModal}
        onClose={() => {
          setShowFinalizeModal(false);
          setFinalizeConfirmed(false);
        }}
        title="Finalize Bill - Confirm Action"
        size="md"
      >
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-yellow-900">Warning: This action cannot be undone</p>
                <p className="text-sm text-yellow-700 mt-1">
                  Once finalized, you will not be able to edit or delete this bill.
                </p>
              </div>
            </div>
          </div>

          {selectedBill && (
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Bill Summary</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-gray-600">Bill Number:</div>
                <div className="font-semibold text-gray-900">{selectedBill.bill_no}</div>
                
                <div className="text-gray-600">Bill Date:</div>
                <div className="font-semibold text-gray-900">{formatDate(selectedBill.bill_date)}</div>
                
                <div className="text-gray-600">Client:</div>
                <div className="font-semibold text-gray-900">{selectedBill.client_name || 'N/A'}</div>
                
                <div className="text-gray-600">Number of Services:</div>
                <div className="font-semibold text-gray-900">{selectedBill.services?.length || 0}</div>
                
                <div className="text-gray-600">Total Amount:</div>
                <div className="font-bold text-primary-600 text-lg">{formatCurrency(selectedBill.total_invoice_value)}</div>
              </div>
            </div>
          )}

          <div className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <input
              type="checkbox"
              id="finalize-confirm"
              checked={finalizeConfirmed}
              onChange={(e) => setFinalizeConfirmed(e.target.checked)}
              className="mt-1 w-4 h-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <label htmlFor="finalize-confirm" className="text-sm text-gray-700 cursor-pointer">
              I understand this bill cannot be edited after finalization and I have verified all details are correct.
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              onClick={() => {
                setShowFinalizeModal(false);
                setFinalizeConfirmed(false);
              }}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmFinalize}
              disabled={!finalizeConfirmed || finalizingBill}
              className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {finalizingBill ? 'Finalizing...' : 'Finalize Bill'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Bill Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setBillToDelete(null);
          setDeleteConfirmText('');
        }}
        title="Delete Bill - Confirm Action"
        size="md"
      >
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-900">Permanent Deletion Warning</p>
                <p className="text-sm text-red-700 mt-1">
                  This will permanently delete the bill and all associated data. This action cannot be undone.
                </p>
              </div>
            </div>
          </div>

          {billToDelete && (
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Bill to be Deleted</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-gray-600">Bill Number:</div>
                <div className="flex items-center gap-2">
                  {billToDelete.bill_no ? (
                    <>
                      <span className="font-mono font-semibold text-gray-900">{billToDelete.bill_no}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(billToDelete.bill_no);
                          toast.success('Bill number copied');
                        }}
                        className="text-xs text-indigo-600 hover:text-indigo-800 underline"
                      >
                        Copy
                      </button>
                    </>
                  ) : (
                    <span className="text-sm text-gray-500 italic">Not assigned (Draft)</span>
                  )}
                </div>
                
                <div className="text-gray-600">Total Amount:</div>
                <div className="font-semibold text-red-600">{formatCurrency(billToDelete.total_invoice_value)}</div>
                
                <div className="text-gray-600">Created On:</div>
                <div className="font-semibold text-gray-900">{formatDate(billToDelete.created_at)}</div>
                
                <div className="text-gray-600">Created By:</div>
                <div className="font-semibold text-gray-900">{billToDelete.created_by_name}</div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              {billToDelete?.bill_no ? (
                <>Type <span className="font-mono font-bold text-red-600">{billToDelete.bill_no}</span> to confirm deletion:</>
              ) : (
                <>Type <span className="font-mono font-bold text-red-600">DELETE</span> to confirm deletion of this draft:</>
              )}
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Enter bill number exactly"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            {deleteConfirmText && deleteConfirmText !== (billToDelete?.bill_no || 'DELETE') && (
              <p className="text-xs text-red-600">
                {billToDelete?.bill_no ? 'Bill number does not match' : 'Please type DELETE exactly'}
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              onClick={() => {
                setShowDeleteModal(false);
                setBillToDelete(null);
                setDeleteConfirmText('');
              }}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleteConfirmText !== (billToDelete?.bill_no || 'DELETE')}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete Permanently
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Header Pick Modal (cross-company merge) ─────────────────── */}
      <Modal
        isOpen={showHeaderPickModal}
        onClose={() => { setShowHeaderPickModal(false); setPickedHeaderId(null); }}
        title="Choose Company Header"
      >
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 flex items-start gap-3">
            <GitMerge className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Same client, different companies</p>
              <p className="text-xs text-amber-600 mt-1">
                The selected bills are from different company headers but belong to the same client.
                Choose which company's letterhead the merged bill should carry.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {mergeHeaderOptions.map(opt => (
              <button
                key={opt.id}
                onClick={() => setPickedHeaderId(opt.id)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border-2 text-left transition-colors ${
                  pickedHeaderId === opt.id
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                }`}
              >
                <span className="text-sm font-medium text-gray-800">{opt.name}</span>
                {pickedHeaderId === opt.id && (
                  <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-full">Selected</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => { setShowHeaderPickModal(false); setPickedHeaderId(null); }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleHeaderPickConfirm}
              disabled={!pickedHeaderId}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <GitMerge className="w-4 h-4" />
              Continue to Merge
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Merge Confirmation Modal ────────────────────────────────── */}
      <Modal
        isOpen={showMergeModal}
        onClose={() => { setShowMergeModal(false); setMergeNotes(''); }}
        title="Confirm Merge"
      >
        <div className="space-y-4">
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <GitMerge className="w-5 h-5 text-indigo-600" />
              <p className="text-sm font-semibold text-indigo-800">
                Merge {selectedForMerge.length} bills —{' '}
                {crossCompany
                  ? (mergeHeaderOptions.find(h => h.id === pickedHeaderId)?.name || '')
                  : mergeCompanyName}
              </p>
            </div>
            <div className="space-y-1.5">
              {selectedBillObjects.map(b => (
                <div key={b.id} className="flex items-center justify-between text-xs bg-white rounded px-3 py-1.5 border border-indigo-100">
                  <span className="font-mono text-gray-700">{b.bill_no || b.display_ref || `DRAFT-${b.id}`}</span>
                  <span className="text-gray-500">{formatDate(b.bill_date)}</span>
                  <span className="font-semibold text-gray-800">{formatCurrency(b.total_invoice_value)}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-500">
            The selected bills will be marked <strong>Absorbed</strong> and their services combined into a new Draft bill. The real bill number is assigned only when you finalize the merged bill. This can be reversed with <strong>Unmerge</strong> as long as the merged bill stays as Draft.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={mergeNotes}
              onChange={e => setMergeNotes(e.target.value)}
              placeholder="e.g. Combined Q3 services for Sharma & Co."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => { setShowMergeModal(false); setMergeNotes(''); }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmMerge}
              disabled={merging}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
            >
              {merging ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Merging...</>
              ) : (
                <><GitMerge className="w-4 h-4" /> Merge Bills</>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Unmerge Confirmation Modal ──────────────────────────────── */}
      <Modal
        isOpen={showUnmergeModal}
        onClose={() => { setShowUnmergeModal(false); setBillToUnmerge(null); }}
        title="Confirm Unmerge"
      >
        <div className="space-y-4">
          <div className="bg-purple-50 border border-purple-100 rounded-lg p-4 flex items-start gap-3">
            <GitBranch className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-purple-800">Restore source bills</p>
              <p className="text-xs text-purple-600 mt-1">
                The merged draft will be deleted. All source bills that were absorbed will be restored to <strong>Draft</strong> status with their original services intact.
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            This action cannot be undone after the bills are separately edited or finalized.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => { setShowUnmergeModal(false); setBillToUnmerge(null); }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmUnmerge}
              disabled={unmerging}
              className="px-5 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
            >
              {unmerging ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Unmerging...</>
              ) : (
                <><GitBranch className="w-4 h-4" /> Yes, Unmerge</>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Override Payments Modal (SUPERADMIN) ─────────────────────── */}
      <Modal
        isOpen={showOverridePaymentsModal}
        onClose={() => {
          setShowOverridePaymentsModal(false);
          setOverridePaymentsBill(null);
          setOverridePayments([]);
          setEditingPayments({});
        }}
        title={`Override Payments — ${overridePaymentsBill?.bill_no || ''}`}
        size="xl"
      >
        <div className="space-y-4">
          {/* Warning banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">SUPERADMIN Override — All changes are audit-logged</p>
              <p className="text-xs text-amber-600 mt-0.5">Edit payment details below and click Save on each row to apply changes.</p>
            </div>
          </div>

          {overridePayments.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">No payment records found for this bill.</div>
          ) : (
            <div className="space-y-4">
              {overridePayments.map((payment, idx) => {
                const ep = editingPayments[payment.id] || {};
                const isSaving = savingPaymentId === payment.id;
                return (
                  <div key={payment.id} className="border border-amber-200 rounded-lg p-4 bg-amber-50/30">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                        Payment #{idx + 1} &nbsp;·&nbsp; Recorded by {payment.recorded_by_name || 'N/A'}
                      </span>
                      <button
                        onClick={() => handleSaveOverridePayment(payment.id)}
                        disabled={isSaving}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isSaving ? (
                          <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</>
                        ) : (
                          'Save'
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                      {/* Payment Date */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
                        <input
                          type="date"
                          value={ep.payment_date || ''}
                          onChange={e => handleOverridePaymentFieldChange(payment.id, 'payment_date', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>

                      {/* Amount Paid */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Amount Paid (₹)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={ep.amount_paid || ''}
                          onChange={e => handleOverridePaymentFieldChange(payment.id, 'amount_paid', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>

                      {/* Payment Mode */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Payment Mode</label>
                        <select
                          value={ep.payment_mode || 'NEFT'}
                          onChange={e => handleOverridePaymentFieldChange(payment.id, 'payment_mode', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        >
                          <option value="NEFT">NEFT</option>
                          <option value="UPI">UPI</option>
                          <option value="CASH">CASH</option>
                          <option value="CHEQUE">CHEQUE</option>
                        </select>
                      </div>

                      {/* UTR / Reference No. — always visible */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">UTR / Reference No.</label>
                        <input
                          type="text"
                          value={ep.utr || ''}
                          onChange={e => handleOverridePaymentFieldChange(payment.id, 'utr', e.target.value)}
                          placeholder="UTR number"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>

                      {/* Cheque No. — always visible */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Cheque No.</label>
                        <input
                          type="text"
                          value={ep.cheque_no || ''}
                          onChange={e => handleOverridePaymentFieldChange(payment.id, 'cheque_no', e.target.value)}
                          placeholder="Cheque number"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>

                      {/* Cash Collected By — always visible */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Cash Collected By</label>
                        <input
                          type="text"
                          value={ep.cash_collected_by || ''}
                          onChange={e => handleOverridePaymentFieldChange(payment.id, 'cash_collected_by', e.target.value)}
                          placeholder="Person who collected"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>

                      {/* Received In Bank Account */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Received In Account</label>
                        <select
                          value={ep.received_in_account_id || ''}
                          onChange={e => handleOverridePaymentFieldChange(payment.id, 'received_in_account_id', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        >
                          <option value="">— None —</option>
                          {overrideBankAccounts.map(acc => (
                            <option key={acc.header_id} value={acc.header_id}>
                              {acc.bank_name} – {acc.account_number} ({acc.company_name})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Notes */}
                      <div className="col-span-2 md:col-span-3">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                        <input
                          type="text"
                          value={ep.notes || ''}
                          onChange={e => handleOverridePaymentFieldChange(payment.id, 'notes', e.target.value)}
                          placeholder="Optional notes"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Write-Off section (PARTIAL bills only) ── */}
          {overridePaymentsBill &&
           overridePaymentsBill.payment_status === 'PARTIAL' &&
           parseFloat(overridePaymentsBill.writeoff_amount || 0) === 0 && (
            <div className="border border-orange-200 rounded-lg p-4 bg-orange-50/40 mt-2">
              <p className="text-sm font-semibold text-orange-800 mb-1">Write Off Remaining Balance</p>
              <p className="text-xs text-orange-700 mb-3">
                Outstanding:{' '}
                <strong>
                  ₹{(parseFloat(overridePaymentsBill.total_invoice_value) - parseFloat(overridePaymentsBill.total_paid || 0)).toFixed(2)}
                </strong>
                {' '}— this will be written off and the bill will be marked as <strong>Paid</strong>. This cannot be undone.
              </p>
              <textarea
                value={writeOffNotes}
                onChange={e => setWriteOffNotes(e.target.value)}
                rows={2}
                placeholder="Reason for write-off (optional)..."
                className="w-full px-3 py-2 border border-orange-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white mb-3"
              />
              <button
                onClick={handleWriteOffFromModal}
                disabled={writingOff}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white text-sm font-semibold rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
              >
                {writingOff
                  ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /><span>Processing...</span></>
                  : 'Confirm Write-Off'
                }
              </button>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={() => {
                setShowOverridePaymentsModal(false);
                setOverridePaymentsBill(null);
                setOverridePayments([]);
                setEditingPayments({});
              }}
              className="px-5 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      {/* Write-Off Confirmation Modal */}
      {showWriteOffModal && selectedBill && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Write Off Remaining Balance</h3>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-amber-800">
                This will write off <strong>₹{(parseFloat(selectedBill.total_invoice_value) - parseFloat(selectedBill.total_paid || 0)).toFixed(2)}</strong> and mark the bill as <strong>Paid</strong>.
                This action cannot be undone.
              </p>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={writeOffNotes}
                onChange={e => setWriteOffNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                placeholder="Reason for write-off..."
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button onClick={() => { setShowWriteOffModal(false); setWriteOffNotes(''); }} className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50" disabled={writingOff}>Cancel</button>
              <button onClick={handleWriteOff} disabled={writingOff} className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center space-x-2">
                {writingOff ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Processing...</span></> : <span>Confirm Write-Off</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Animations */}
      {showSuccessAnimation && <SuccessCheckmark onComplete={() => setShowSuccessAnimation(false)} />}
      {showPaymentAnimation && <PaymentAnimation amount={animationAmount} onComplete={() => setShowPaymentAnimation(false)} />}
      {showFinalizeAnimation && <FinalizeAnimation onComplete={() => setShowFinalizeAnimation(false)} />}

    </div>
  );
};

export default PrintBillPage;