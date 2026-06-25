import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Save, Eye, AlertTriangle, Lock, CreditCard, RefreshCw, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { FormSkeleton } from '../components/common/SkeletonLoader';
import { SuccessCheckmark } from '../components/common/SuccessAnimation';
import ServiceRow from '../components/forms/ServiceRow';
import Dropdown from '../components/common/Dropdown';
import SearchableDropdown from '../components/common/SearchableDropdown';
import Modal from '../components/common/Modal';
import { billAPI, clientAPI, masterAPI } from '../services/api';
import { formatCurrency, getFinancialYear, debounce } from '../utils/helpers';
import DatePicker from 'react-datepicker';
import { useAuth } from '../context/AuthContext';
import useEditLock from '../hooks/useEditLock';

const ServicesFormPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const editToastShownRef = useRef(false); // prevents double toast in React Strict Mode
  const [loading, setLoading] = useState(false);
  const [masterDataLoading, setMasterDataLoading] = useState(true);
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editBillId, setEditBillId] = useState(null);
  const [overrideMode, setOverrideMode] = useState(false); // SUPERADMIN override edit of finalized bills

  // Edit lock — prevents two users editing the same bill simultaneously
  const { lockStatus, acquireLock, releaseLock } = useEditLock(editBillId, user?.id);

  // NEW: Unsaved changes tracking
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Back button warning modal (unsaved changes guard)
  const [showBackWarningModal, setShowBackWarningModal] = useState(false);

  // Duplicate service row warning modal
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateRowNumbers, setDuplicateRowNumbers] = useState([]);

  // Similar client warning modal (Option B — clickable existing clients)
  const [showSimilarClientModal, setShowSimilarClientModal] = useState(false);
  const [similarClients, setSimilarClients] = useState([]);
  const [pendingClientData, setPendingClientData] = useState(null);

  // Default GST rate ID (resolved to the 18% entry after master data loads)
  const [defaultGstRateId, setDefaultGstRateId] = useState('');
  const [nextBillNumber, setNextBillNumber] = useState(null);

  // Master data
  const [headers, setHeaders] = useState([]);
  const [particulars, setParticulars] = useState([]);
  const [clients, setClients] = useState([]);
  const [gstRates, setGstRates] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);

  // Form state
  const [formData, setFormData] = useState({
    header_id: '',
    bill_date: new Date(),
    payment_term_id: '',
    client_id: '',
    notes: '',
    bank_account_id: '',
  });

  // Bank account state
  const [companyBankAccounts, setCompanyBankAccounts] = useState([]); // accounts for selected company
  const [selectedBankAccount, setSelectedBankAccount] = useState(null); // full account object
  const [showBankPopup, setShowBankPopup] = useState(false); // radio selection popup
  const [bankPopupSelection, setBankPopupSelection] = useState(''); // temp selection in popup
  const [bankAccountsLoading, setBankAccountsLoading] = useState(false);

  const [serviceErrors, setServiceErrors] = useState([]);
  const [billNumberPreview, setBillNumberPreview] = useState('');
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [services, setServices] = useState([
    {
      particulars_id: '',
      particulars_other: '',
      service_date: '',
      service_year: new Date().getFullYear().toString(),
      amount: 0,
      gst_rate_id: '',
    },
  ]);

  // Load master data on mount
  useEffect(() => {
    loadMasterData();
  }, []);

  // NEW: Track unsaved changes
  useEffect(() => {
    if (!editMode && (formData.header_id || services.length > 1 || services[0].particulars_id)) {
      setHasUnsavedChanges(true);
    }
  }, [formData, services, editMode]);

  // NEW: Prevent browser close/refresh with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Acquire edit lock when entering edit mode
  useEffect(() => {
    if (editBillId && user?.id) {
      acquireLock();
    }
  }, [editBillId, user?.id]);

  // Preview bill number when company or date changes.
  // Runs in create mode AND DRAFT edit mode (company can change in both).
  // Suppressed in overrideMode (finalized bill — bill_no already assigned).
  useEffect(() => {
    if (formData.header_id && formData.bill_date && !overrideMode) {
      previewBillNumber();
    }
  }, [formData.header_id, formData.bill_date, overrideMode]);

  const previewBillNumber = async () => {
    try {
      const response = await billAPI.previewBillNumber({
        header_id: formData.header_id,
        bill_date: formData.bill_date.toISOString().split('T')[0]
      });
      setBillNumberPreview(response.data.data.next_bill_no);
      setNextBillNumber(response.data.data.next_number);
    } catch (error) {
      console.error('Failed to preview bill number:', error);
    }
  };

  // Fetch bank accounts for a given company, then auto-select or show popup
  const loadBankAccountsForCompany = async (headerId, existingBankAccountId = null) => {
    if (!headerId) {
      setCompanyBankAccounts([]);
      setSelectedBankAccount(null);
      setFormData(prev => ({ ...prev, bank_account_id: '' }));
      return;
    }
    setBankAccountsLoading(true);
    try {
      const res = await masterAPI.getBankAccountsByHeader(headerId);
      const accounts = res.data.data;
      setCompanyBankAccounts(accounts);

      if (accounts.length === 0) {
        setSelectedBankAccount(null);
        setFormData(prev => ({ ...prev, bank_account_id: '' }));
        return;
      }

      // Determine which account to select
      let toSelect = null;
      if (existingBankAccountId) {
        // Edit mode: pre-select the bill's current account
        toSelect = accounts.find(a => a.id === parseInt(existingBankAccountId)) || null;
      }
      if (!toSelect) {
        // Default: primary account
        toSelect = accounts.find(a => a.is_primary) || accounts[0];
      }

      if (accounts.length === 1) {
        // Only one account — silently auto-select
        setSelectedBankAccount(toSelect);
        setFormData(prev => ({ ...prev, bank_account_id: toSelect.id.toString() }));
      } else if (existingBankAccountId) {
        // Edit mode with existing selection — pre-select without popup
        setSelectedBankAccount(toSelect);
        setFormData(prev => ({ ...prev, bank_account_id: toSelect.id.toString() }));
      } else {
        // Multiple accounts and no pre-existing choice — show popup
        setBankPopupSelection(toSelect.id.toString());
        setShowBankPopup(true);
      }
    } catch (error) {
      console.error('Failed to load bank accounts:', error);
      toast.error('Failed to load bank accounts for this company');
    } finally {
      setBankAccountsLoading(false);
    }
  };

  // Handle company dropdown change — fetch bank accounts and trigger popup if needed
  const handleCompanyChange = (headerId) => {
    setFormData(prev => ({ ...prev, header_id: headerId, bank_account_id: '' }));
    setSelectedBankAccount(null);
    setCompanyBankAccounts([]);
    if (headerId) {
      loadBankAccountsForCompany(headerId);
    }
  };

  // Confirm bank account selection from popup
  const handleBankPopupConfirm = () => {
    const account = companyBankAccounts.find(a => a.id.toString() === bankPopupSelection);
    if (account) {
      setSelectedBankAccount(account);
      setFormData(prev => ({ ...prev, bank_account_id: account.id.toString() }));
    }
    setShowBankPopup(false);
  };

  const loadMasterData = async () => {
    setMasterDataLoading(true);
    try {
      const [headersRes, particularsRes, clientsRes, gstRes, paymentRes] = await Promise.all([
        masterAPI.getAllHeaders(),
        masterAPI.getAllParticulars(),
        clientAPI.getAllClients(),
        masterAPI.getAllGSTRates(),
        masterAPI.getAllPaymentTerms(),
      ]);

      setHeaders(headersRes.data.data);
      setParticulars(particularsRes.data.data);
      setClients(clientsRes.data.data);
      setPaymentTerms(paymentRes.data.data);

      const gstData = gstRes.data.data;
      setGstRates(gstData);

      // Find the 18% GST rate and set it as the default for new service rows
      const rate18 = gstData.find(g => parseFloat(g.rate_percentage) === 18);
      if (rate18) {
        const id18 = rate18.id.toString();
        setDefaultGstRateId(id18);
        // Also apply to the initial row already on screen (only if not yet set)
        setServices(prev => prev.map(s =>
          s.gst_rate_id === '' ? { ...s, gst_rate_id: id18 } : s
        ));
      }
    } catch (error) {
      console.error('Failed to load master data:', error);
      toast.error('Failed to load form data');
    }finally {
      setMasterDataLoading(false);
    }
    
  };

  // Effect 1: runs ONCE when navigation state arrives — set mode flags and show toast
  // useRef guard prevents the toast firing twice under React 18 Strict Mode
  useEffect(() => {
    if (location.state?.editBill) {
      const bill = location.state.editBill;
      const isOverride = location.state?.overrideMode === true;

      setEditMode(true);
      setEditBillId(bill.id);
      if (isOverride) setOverrideMode(true);

      if (!editToastShownRef.current) {
        editToastShownRef.current = true;
        if (isOverride) {
          toast('⚠️ Override Edit Mode — editing a finalized bill as SUPERADMIN', { icon: '⚠️', duration: 5000 });
        } else {
          toast.success('Editing DRAFT bill: ' + (bill.display_ref || bill.bill_no || `DRAFT-${bill.id}`));
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Effect 2: populate form fields once clients (master data) are loaded
  useEffect(() => {
    if (!location.state?.editBill || clients.length === 0) return;

    const bill = location.state.editBill;

    setFormData({
      header_id: bill.header_id?.toString() || '',
      bill_date: new Date(bill.bill_date),
      payment_term_id: bill.payment_term_id?.toString() || '',
      client_id: bill.client_id?.toString() || '',
      notes: bill.notes || '',
      bank_account_id: bill.bank_account_id?.toString() || '',
    });

    // Load bank accounts for the company and pre-select the bill's account (no popup)
    if (bill.header_id) {
      loadBankAccountsForCompany(bill.header_id.toString(), bill.bank_account_id);
    }

    if (bill.services && bill.services.length > 0) {
      setServices(bill.services.map(s => {
        // Normalise legacy service_year: "2025" → "2024-25"
        let sy = s.service_year || '';
        if (sy && /^\d{4}$/.test(sy)) {
          const end = parseInt(sy);
          sy = `${end - 1}-${String(end).slice(-2)}`;
        }
        return {
          id: s.id,
          particulars_id: s.particulars_id?.toString() || '',
          particulars_other: s.particulars_other || '',
          description: s.description || '',
          service_date: s.service_date ? s.service_date.split('T')[0] : '',
          service_year: sy,
          amount: parseFloat(s.amount),
          gst_rate_id: s.gst_rate_id?.toString() || '',
        };
      }));
    }
  }, [location.state, clients]);

  const handleAddService = () => {
    setServices([
      ...services,
      {
        particulars_id: '',
        particulars_other: '',
        service_date: '',
        service_year: (() => { const t = new Date(); const m = t.getMonth()+1; const y = t.getFullYear(); return m>=4 ? `${y}-${String(y+1).slice(-2)}` : `${y-1}-${String(y).slice(-2)}`; })(),
        amount: 0,
        gst_rate_id: defaultGstRateId,
      },
    ]);
  };

  const handleRemoveService = (index) => {
    if (services.length > 1) {
      setServices(services.filter((_, i) => i !== index));
    } else {
      toast.error('At least one service is required');
    }
  };

  const handleServiceChange = (index, updatedService) => {
    const newServices = [...services];
    newServices[index] = updatedService;
    setServices(newServices);
  };

  // NEW: Validate services before submission
  const validateServices = () => {
    const errors = [];
    const duplicates = [];
    
    services.forEach((service, index) => {
      // Check for empty required fields
      if (!service.particulars_id || !service.amount || !service.gst_rate_id) {
        errors.push(index);
      }
      
      // Check for duplicates
      const duplicate = services.findIndex((s, i) => 
        i !== index &&
        s.particulars_id === service.particulars_id &&
        s.service_date === service.service_date &&
        s.service_year === service.service_year
      );
      
      if (duplicate !== -1 && !duplicates.includes(index)) {
        duplicates.push(index);
      }
    });
    
    setServiceErrors(errors);
    
    if (errors.length > 0) {
      toast.error(`Service row ${errors[0] + 1} has empty required fields`);
      // Scroll to first error
      document.querySelector(`[data-service-index="${errors[0]}"]`)?.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
      return false;
    }
    
    if (duplicates.length > 0) {
      setDuplicateRowNumbers(duplicates.map(i => i + 1));
      setShowDuplicateModal(true);
      return false;
    }
    
    return true;
  };

  const handleSearchClients = debounce(async (searchTerm) => {
    if (!searchTerm) return;
    try {
      const response = await clientAPI.searchClients(searchTerm);
      setClients(response.data.data);
    } catch (error) {
      console.error('Failed to search clients:', error);
      toast.error('Failed to search clients');
    }
  }, 200);

  const handleCreateClient = (clientName) => {
    setNewClientName(clientName);
    setShowClientModal(true);
  };

  const handleSaveNewClient = async (e) => {
    e.preventDefault();
    const clientFormData = new FormData(e.target);

    try {
      const clientData = {
        client_name: clientFormData.get('client_name'),
        contact_person: clientFormData.get('contact_person'),
        phone: clientFormData.get('phone'),
        email: clientFormData.get('email'),
        gstin: clientFormData.get('gstin') || null,
        pan: clientFormData.get('pan') || null,
      };

      const response = await clientAPI.createClient(clientData);

      if (response.data.warning) {
        // Stash clientData and show the similar client modal (Option B — clickable names).
        // The "Add New Client" modal stays open behind it.
        setPendingClientData(clientData);
        setSimilarClients(response.data.similar_clients || []);
        setShowSimilarClientModal(true);
        return;
      }

      // No warning — straight creation
      const newClient = response.data.data;
      setClients(prev => [...prev, newClient]);
      setFormData(prev => ({ ...prev, client_id: newClient.id.toString() }));
      toast.success('Client created successfully');
      setShowClientModal(false);
      setNewClientName('');
    } catch (error) {
      console.error('Failed to create client:', error);
      toast.error('Failed to create client');
    }
  };

  // User clicked an existing similar client — use it instead of creating a new one.
  const handleSimilarClientSelect = (client) => {
    // Ensure the client exists in the dropdown options list
    setClients(prev => (prev.find(c => c.id === client.id) ? prev : [...prev, client]));
    setFormData(prev => ({ ...prev, client_id: client.id.toString() }));
    // Close both modals
    setShowSimilarClientModal(false);
    setShowClientModal(false);
    setNewClientName('');
    setPendingClientData(null);
    setSimilarClients([]);
    toast.success(`Selected: ${client.client_name}`);
  };

  // User chose to create the new client despite the similarity warning.
  const handleCreateClientAnyway = async () => {
    if (!pendingClientData) return;
    try {
      const finalResponse = await clientAPI.createClient(pendingClientData);
      const newClient = finalResponse.data.data;
      if (newClient?.id) {
        setClients(prev => [...prev, newClient]);
        setFormData(prev => ({ ...prev, client_id: newClient.id.toString() }));
        toast.success('Client created successfully');
      }
    } catch (error) {
      console.error('Failed to create client:', error);
      toast.error('Failed to create client');
    } finally {
      setShowSimilarClientModal(false);
      setShowClientModal(false);
      setNewClientName('');
      setPendingClientData(null);
      setSimilarClients([]);
    }
  };

  const calculateTotals = () => {
    let subtotal = 0;
    let gstTotal = 0;

    services.forEach((service) => {
      const amount = parseFloat(service.amount) || 0;
      const gstRate = gstRates.find((g) => g.id === parseInt(service.gst_rate_id));
      const gstAmount = gstRate ? (amount * parseFloat(gstRate.rate_percentage)) / 100 : 0;

      subtotal += amount;
      gstTotal += gstAmount;
    });

    return {
      subtotal,
      gstTotal,
      total: subtotal + gstTotal,
    };
  };

  // Core bill save logic — called by handleSubmit (normal path) and
  // handleDuplicateConfirm (user chose to proceed past the duplicate warning).
  const submitBill = async () => {
    setLoading(true);
    setHasUnsavedChanges(false);

    try {
      // Validate services (field completeness only — duplicate check already done)
      const invalidService = services.find(
        (s) => !s.particulars_id || !s.amount || !s.gst_rate_id
      );

      if (invalidService) {
        toast.error('Please fill all required fields in services');
        setLoading(false);
        return;
      }

      if (editMode) {
        // UPDATE existing bill
        const billData = {
          // Include header_id on DRAFT edits so company reassignment reaches the backend.
          // Excluded on overrideMode (finalized bill) — company cannot change on finalized bills.
          ...(!overrideMode && { header_id: parseInt(formData.header_id) }),
          bill_date: formData.bill_date.toISOString().split('T')[0],
          payment_term_id: parseInt(formData.payment_term_id),
          client_id: formData.client_id ? parseInt(formData.client_id) : null,
          notes: formData.notes,
          bank_account_id: formData.bank_account_id ? parseInt(formData.bank_account_id) : undefined,
          services: services.map((s) => ({
            particulars_id: parseInt(s.particulars_id),
            particulars_other: s.particulars_other || null,
            description: s.description || null,
            service_date: s.service_date,
            service_year: s.service_year,
            amount: parseFloat(s.amount),
            gst_rate_id: parseInt(s.gst_rate_id),
          })),
        };

        await billAPI.updateBill(editBillId, billData, overrideMode);

        setShowSuccessAnimation(true);
        setTimeout(() => {
          toast.success(overrideMode ? 'Bill override edit saved!' : 'Bill updated successfully!');
          setShowSuccessAnimation(false);
          navigate('/print-bill');
        }, 1000);
      } else {
        // CREATE new bill
        if (!formData.bank_account_id) {
          toast.error('Please select a bank account before creating the bill.');
          setLoading(false);
          return;
        }

        const billData = {
          header_id: parseInt(formData.header_id),
          bill_date: formData.bill_date.toISOString().split('T')[0],
          payment_term_id: parseInt(formData.payment_term_id),
          client_id: formData.client_id ? parseInt(formData.client_id) : null,
          notes: formData.notes,
          bank_account_id: parseInt(formData.bank_account_id),
          services: services.map((s) => ({
            particulars_id: parseInt(s.particulars_id),
            particulars_other: s.particulars_other || null,
            description: s.description || null,
            service_date: s.service_date,
            service_year: s.service_year,
            amount: parseFloat(s.amount),
            gst_rate_id: parseInt(s.gst_rate_id),
          })),
        };

        const response = await billAPI.createBill(billData);
        const createdBill = response.data.data;

        setShowSuccessAnimation(true);
        setTimeout(() => {
          toast.success(`Bill ${createdBill.display_ref || createdBill.bill_no || '#' + createdBill.id} created successfully!`);
          setShowSuccessAnimation(false);
          navigate('/print-bill', { state: { billId: createdBill.id } });
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to save bill:', error);
      toast.error(error.response?.data?.message || 'Failed to save bill');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.client_id) {
      toast.error('Client Name is required. Please select a client before saving.');
      return;
    }

    if (!validateServices()) return;

    await submitBill();
  };

  // Called by the duplicate warning modal's "Continue Anyway" button.
  const handleDuplicateConfirm = async () => {
    setShowDuplicateModal(false);
    await submitBill();
  };

  // Back button — returns to the Print Bill list.
  // No need to call releaseLock() manually: useEditLock's unmount cleanup
  // fires automatically when navigate() causes the component to unmount.
  const handleBack = () => {
    if (hasUnsavedChanges) {
      setShowBackWarningModal(true);
      return;
    }
    navigate('/print-bill');
  };

  const handleBackConfirm = () => {
    setShowBackWarningModal(false);
    navigate('/print-bill');
  };

  const totals = calculateTotals();

  // Prepare options for dropdowns
  const headerOptions = headers.map((h) => ({ value: h.id, label: h.company_name }));
  const particularsOptions = particulars.map((p) => ({ value: p.id, label: p.service_name }));
  const clientOptions = clients.map((c) => ({ value: c.id.toString(), label: c.client_name }));
  const gstRateOptions = gstRates.map((g) => ({
    value: g.id,
    label: `${g.rate_percentage}% - ${g.description}`,
    rate: g.rate_percentage,
  }));
  const paymentTermOptions = paymentTerms.map((p) => ({ value: p.id, label: p.term_name }));

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">
        {overrideMode ? 'Override Edit (SUPERADMIN)' : editMode ? 'Edit Bill (DRAFT)' : 'Services Form'}
      </h1>

      {/* Override Edit Warning Banner */}
      {overrideMode && (
        <div className="flex items-center space-x-3 bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div>
            <p className="text-amber-800 text-sm font-semibold">SUPERADMIN Override Edit Mode</p>
            <p className="text-amber-700 text-xs mt-0.5">You are editing a finalized bill. Changes will be saved and logged in the audit trail. The bill status will not change.</p>
          </div>
        </div>
      )}

      {/* Edit Lock Warning Banner */}
      {editMode && !overrideMode && !lockStatus.canEdit && (
        <div className="flex items-center space-x-3 bg-red-50 border border-red-300 rounded-lg p-4 mb-4">
          <Lock className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-700 text-sm font-medium">
            This bill is currently being edited by <strong>{lockStatus.lockedByName}</strong>. You are in view-only mode.
          </p>
        </div>
      )}

      {masterDataLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="spinner"></div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Header Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Bill Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Company Selection */}
              <Dropdown
                label="Bill For (Company)"
                value={formData.header_id}
                onChange={(value) => {
                  // Allow company change when creating OR when editing a DRAFT bill.
                  // Blocked only on override-edit of FINALIZED bills (overrideMode).
                  if (!overrideMode) {
                    handleCompanyChange(value);
                  }
                }}
                options={headerOptions}
                placeholder="Select Company"
                disabled={overrideMode}
                required
              />

              {/* Bill Number — shown in create mode and DRAFT edit mode */}
              {!overrideMode && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Bill Number
                  </label>
                  <div className="px-3 py-2 border border-amber-300 bg-amber-50 rounded-lg text-sm font-semibold text-amber-800 min-h-[38px]">
                    Draft — assigned on Finalize
                  </div>
                  {billNumberPreview && (
                    <p className="text-xs text-gray-400 mt-1">
                      Next finalized number will be: {billNumberPreview}
                    </p>
                  )}
                </div>
              )}

              {/* Bill Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bill Date <span className="text-red-500">*</span>
                </label>
                <DatePicker
                  selected={formData.bill_date}
                  onChange={(date) => setFormData({ ...formData, bill_date: date })}
                  dateFormat="dd/MM/yyyy"
                  showMonthDropdown
                  showYearDropdown
                  dropdownMode="select"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  FY: {getFinancialYear(formData.bill_date)}
                </p>
              </div>

              {/* Client Name */}
              <SearchableDropdown
                label="Client Name *"
                value={formData.client_id}
                onChange={(value) => setFormData({ ...formData, client_id: value })}
                options={clientOptions}
                placeholder="Search client..."
                onSearch={handleSearchClients}
                allowCreate
                onCreate={handleCreateClient}
                required
              />

              {/* Payment Terms */}
              <Dropdown
                label="Payment Terms"
                value={formData.payment_term_id}
                onChange={(value) => setFormData({ ...formData, payment_term_id: value })}
                options={paymentTermOptions}
                placeholder="Select Payment Terms"
                required
              />
            </div>

            {/* Notes */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows="2"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Additional notes (optional)"
              />
            </div>
          </div>

          {/* Services Table */}
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Services</h2>
              <button
                type="button"
                onClick={handleAddService}
                className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add Row</span>
              </button>
            </div>

            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Sr. No
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Particulars
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Year
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    GST Rate
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    GST Amount
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Total
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {services.map((service, index) => (
                  <ServiceRow
                    key={index}
                    service={service}
                    index={index}
                    onChange={handleServiceChange}
                    onRemove={handleRemoveService}
                    particularsOptions={particularsOptions}
                    gstRatesOptions={gstRateOptions}
                    hasError={serviceErrors.includes(index)}
                  />
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td colSpan="7" className="px-4 py-3 text-right">Subtotal:</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(totals.subtotal)}</td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan="7" className="px-4 py-3 text-right">GST Total:</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(totals.gstTotal)}</td>
                  <td></td>
                </tr>
                <tr className="text-lg">
                  <td colSpan="7" className="px-4 py-3 text-right">Total Invoice Value:</td>
                  <td className="px-4 py-3 text-right text-primary-600">{formatCurrency(totals.total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Bank Account Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <CreditCard className="w-5 h-5 text-gray-400" />
                <h2 className="text-lg font-semibold text-gray-900">Bank Account</h2>
              </div>
              {/* Show "Change" button if:
                  - Company is selected and has >1 account
                  - AND user has permission (any user for DRAFT, SUPERADMIN for FINALIZED) */}
              {companyBankAccounts.length > 1 && formData.header_id && (
                (() => {
                  const isSuperAdmin = user?.role === 'SUPERADMIN';
                  const isFinalized = editMode && overrideMode; // overrideMode only for finalized
                  const canChange = !isFinalized || isSuperAdmin;
                  return canChange ? (
                    <button
                      type="button"
                      onClick={() => {
                        setBankPopupSelection(formData.bank_account_id);
                        setShowBankPopup(true);
                      }}
                      className="flex items-center space-x-1 px-3 py-1.5 text-sm text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Change</span>
                    </button>
                  ) : null;
                })()
              )}
            </div>

            {bankAccountsLoading ? (
              <div className="text-sm text-gray-400">Loading bank accounts...</div>
            ) : !formData.header_id ? (
              <div className="text-sm text-gray-400 italic">Select a company to see its bank account.</div>
            ) : companyBankAccounts.length === 0 ? (
              <div className="text-sm text-amber-600">
                ⚠ This company has no bank account configured. Please add one in Company Master before creating a bill.
              </div>
            ) : selectedBankAccount ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-400 uppercase font-medium mb-0.5">Bank</p>
                  <p className="text-gray-800 font-medium">{selectedBankAccount.bank_name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase font-medium mb-0.5">Account Holder</p>
                  <p className="text-gray-800">{selectedBankAccount.account_holder_name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase font-medium mb-0.5">Account No.</p>
                  <p className="text-gray-800 font-mono">{selectedBankAccount.account_number || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase font-medium mb-0.5">IFSC</p>
                  <p className="text-gray-800 font-mono">{selectedBankAccount.ifsc_code || '—'}</p>
                </div>
                {selectedBankAccount.nick_name && (
                  <div className="col-span-2 md:col-span-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary-50 text-primary-700 border border-primary-200">
                      {selectedBankAccount.nick_name}
                      {selectedBankAccount.is_primary && ' · Primary'}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-400 italic">No bank account selected.</div>
            )}
          </div>

          {/* Submit Button */}
          <div className="flex items-center justify-between">
            {/* Back button — only in edit mode */}
            {editMode ? (
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center space-x-2 px-4 py-3 text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Bills</span>
              </button>
            ) : (
              <div /> /* spacer to keep submit button right-aligned on create form */
            )}
            <button
              type="submit"
              disabled={loading || (editMode && !overrideMode && !lockStatus.canEdit)}
              className={`flex items-center space-x-2 px-6 py-3 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                overrideMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              <Save className="w-5 h-5" />
              <span>
                {loading
                  ? (overrideMode ? 'Saving Override...' : editMode ? 'Updating Bill...' : 'Creating Bill...')
                  : (editMode && !overrideMode && !lockStatus.canEdit)
                  ? 'View Only (Locked)'
                  : overrideMode
                  ? 'Save Override Edit'
                  : (editMode ? 'Update Bill' : 'Create Bill')
                }
              </span>
            </button>
          </div> {/* end submit row */}
        </form>
      )}

      {/* Success Animation — handled by SuccessCheckmark below */}

      {/* New Client Modal */}
      <Modal
        isOpen={showClientModal}
        onClose={() => {
          setShowClientModal(false);
          setNewClientName('');
        }}
        title="Add New Client"
        size="lg"
      >
        <form onSubmit={handleSaveNewClient} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Client Name */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="client_name"
                defaultValue={newClientName}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* Contact Person */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Contact Person 
              </label>
              <input
                type="text"
                name="contact_person"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Enter contact person name"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone 
              </label>
              <input
                type="tel"
                name="phone"
                pattern="[0-9]{10}"
                maxLength={10}
                onInput={(e) => {
                  e.target.value = e.target.value.replace(/[^0-9]/g, '');
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="10 digit phone number"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                name="email"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="email@example.com"
              />
            </div>

            {/* GSTIN */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                GSTIN <span className="text-gray-400 text-xs font-normal">(optional)</span>
              </label>
              <input
                type="text"
                name="gstin"
                pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}"
                maxLength={15}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="27AABCU9603R1ZM"
              />
              <p className="text-xs text-gray-500 mt-1">15 characters (e.g., 27AABCU9603R1ZM)</p>
            </div>

            {/* PAN */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                PAN <span className="text-gray-400 text-xs font-normal">(optional)</span>
              </label>
              <input
                type="text"
                name="pan"
                pattern="[A-Z]{5}[0-9]{4}[A-Z]{1}"
                maxLength={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="ABCDE1234F"
                title="10-character PAN (e.g. ABCDE1234F)"
                onInput={(e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); }}
              />
              <p className="text-xs text-gray-500 mt-1">10 characters (e.g., ABCDE1234F)</p>
            </div>
          </div>

          {/* Address Section */}
          <div className="pt-4 border-t">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Address Details (Optional)</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address Line 1
                </label>
                <input
                  type="text"
                  name="address_line1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Building/Street"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address Line 2
                </label>
                <input
                  type="text"
                  name="address_line2"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Area/Landmark"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input
                    type="text"
                    name="city"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Mumbai"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input
                    type="text"
                    name="state"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="Maharashtra"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label>
                  <input
                    type="text"
                    name="pincode"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="400001"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowClientModal(false);
                setNewClientName('');
              }}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Save Client
            </button>
          </div>
        </form>
      </Modal>

      {/* Back Button — Unsaved Changes Warning Modal */}
      <Modal
        isOpen={showBackWarningModal}
        onClose={() => setShowBackWarningModal(false)}
        title="Unsaved Changes"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-700">
              You have unsaved changes. If you go back now, your changes will be lost.
            </p>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={() => setShowBackWarningModal(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
            >
              Stay
            </button>
            <button
              type="button"
              onClick={handleBackConfirm}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
            >
              Leave Anyway
            </button>
          </div>
        </div>
      </Modal>

      {/* Duplicate Service Row Warning Modal */}
      <Modal
        isOpen={showDuplicateModal}
        onClose={() => setShowDuplicateModal(false)}
        title="Duplicate Service Detected"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-gray-700">
                Row {duplicateRowNumbers.join(', ')} appears to be a duplicate — same service, year, and date as another row.
              </p>
              <p className="text-sm text-gray-500 mt-1">Do you want to continue anyway?</p>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={() => setShowDuplicateModal(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
            >
              Go Back
            </button>
            <button
              type="button"
              onClick={handleDuplicateConfirm}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm"
            >
              Continue Anyway
            </button>
          </div>
        </div>
      </Modal>

      {/* Similar Client Warning Modal (Option B — clickable existing clients) */}
      <Modal
        isOpen={showSimilarClientModal}
        onClose={() => setShowSimilarClientModal(false)}
        title="Similar Clients Found"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            The following clients already exist with similar names. Select one to use it, or create a new client anyway.
          </p>
          <div className="space-y-2">
            {similarClients.map(client => (
              <button
                key={client.id}
                type="button"
                onClick={() => handleSimilarClientSelect(client)}
                className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-primary-400 hover:bg-primary-50 transition-colors"
              >
                <p className="text-sm font-medium text-gray-900">{client.client_name}</p>
                {client.contact_person && (
                  <p className="text-xs text-gray-500 mt-0.5">{client.contact_person}</p>
                )}
              </button>
            ))}
          </div>
          <div className="flex justify-end space-x-3 pt-2 border-t">
            <button
              type="button"
              onClick={() => setShowSimilarClientModal(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
            >
              Go Back
            </button>
            <button
              type="button"
              onClick={handleCreateClientAnyway}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
            >
              Create New Anyway
            </button>
          </div>
        </div>
      </Modal>

      {/* Success Animation */}
      {showSuccessAnimation && <SuccessCheckmark onComplete={() => setShowSuccessAnimation(false)} />}

      {/* Bank Account Selection Popup */}
      <Modal
        isOpen={showBankPopup}
        onClose={() => setShowBankPopup(false)}
        title="Select Bank Account"
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            This company has multiple bank accounts. Choose which one to use for this bill.
          </p>
          <div className="space-y-2">
            {companyBankAccounts.map(account => (
              <label
                key={account.id}
                className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  bankPopupSelection === account.id.toString()
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="bank_account_popup"
                  value={account.id.toString()}
                  checked={bankPopupSelection === account.id.toString()}
                  onChange={(e) => setBankPopupSelection(e.target.value)}
                  className="mt-0.5 text-primary-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <p className="text-sm font-medium text-gray-900">
                      {account.bank_name || 'Bank Account'}
                    </p>
                    {account.is_primary && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Primary</span>
                    )}
                    {account.nick_name && (
                      <span className="text-xs text-gray-500">· {account.nick_name}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {account.account_holder_name && `${account.account_holder_name} · `}
                    {account.account_number || '—'}
                  </p>
                  {account.ifsc_code && (
                    <p className="text-xs font-mono text-gray-400">{account.ifsc_code}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={() => setShowBankPopup(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleBankPopupConfirm}
              disabled={!bankPopupSelection}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ServicesFormPage;