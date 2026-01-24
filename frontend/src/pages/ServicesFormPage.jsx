import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Save, Eye, AlertTriangle } from 'lucide-react';
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

const ServicesFormPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [masterDataLoading, setMasterDataLoading] = useState(true);
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editBillId, setEditBillId] = useState(null);

  // NEW: Unsaved changes tracking
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

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
    client_id: '',  // ← ADD THIS LINE
    notes: '',
  });

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

  // Preview bill number when company or date changes
  useEffect(() => {
    if (formData.header_id && formData.bill_date && !editMode) {
      previewBillNumber();
    }
  }, [formData.header_id, formData.bill_date, editMode]);

  const previewBillNumber = async () => {
    try {
      const response = await billAPI.previewBillNumber({
        header_id: formData.header_id,
        bill_date: formData.bill_date.toISOString().split('T')[0]
      });
      setBillNumberPreview(response.data.data.next_bill_no);
    } catch (error) {
      console.error('Failed to preview bill number:', error);
    }
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
      setGstRates(gstRes.data.data);
      setPaymentTerms(paymentRes.data.data);
    } catch (error) {
      console.error('Failed to load master data:', error);
      toast.error('Failed to load form data');
    }finally {
      setMasterDataLoading(false);
    }
    
  };

  // Load bill data if editing
  useEffect(() => {
    if (location.state?.editBill) {
      const bill = location.state.editBill;
      console.log("📝 Edit mode - Loading bill:", bill.bill_no);
      
      setEditMode(true);
      setEditBillId(bill.id);
      
      // Wait for master data to load first
      if (clients.length === 0) {
        console.log("⏳ Waiting for clients to load...");
        return; // Don't set form data yet
      }
      
      console.log("✅ Clients loaded, setting form data");
      console.log("📋 Bill client_id:", bill.client_id);
      
      // Check if client exists in loaded clients
      const clientExists = clients.find(c => c.id === bill.client_id);
      console.log("🔍 Client found in list:", clientExists?.client_name);
      
      // Set form data
      setFormData({
        header_id: bill.header_id.toString(),
        bill_date: new Date(bill.bill_date),
        payment_term_id: bill.payment_term_id.toString(),
        client_id: bill.client_id?.toString() || '',
        notes: bill.notes || '',
      });

      // Set services
      if (bill.services && bill.services.length > 0) {
        setServices(bill.services.map(s => ({
          id: s.id,
          particulars_id: s.particulars_id.toString(),
          particulars_other: s.particulars_other || '',
          service_date: s.service_date,
          service_year: s.service_year,
          amount: parseFloat(s.amount),
          gst_rate_id: s.gst_rate_id.toString(),
        })));
      }

      toast.success('Editing DRAFT bill: ' + bill.bill_no);
    }
  }, [location.state, clients]); 

  const handleAddService = () => {
    setServices([
      ...services,
      {
        particulars_id: '',
        particulars_other: '',
        service_date: '',
        service_year: new Date().getFullYear().toString(),
        amount: 0,
        gst_rate_id: '',
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
      const confirmed = window.confirm(
        `Warning: Service at row ${duplicates[0] + 1} appears to be a duplicate. Continue anyway?`
      );
      if (!confirmed) return false;
    }
    
    return true;
  };

  const handleSearchClients = debounce(async (searchTerm) => {
    console.log("🔎 ServicesFormPage - Searching for:", searchTerm);
    
    if (!searchTerm || searchTerm.length < 2) {
      console.log("🔎 Search term too short, skipping");
      return;
    }
    
    try {
      const response = await clientAPI.searchClients(searchTerm);
      console.log("🔎 API Response:", response.data);
      console.log("🔎 Found clients:", response.data.data);
      
      setClients(response.data.data);
      console.log("🔎 Updated clients state, count:", response.data.data.length);
    } catch (error) {
      console.error('❌ Failed to search clients:', error);
    }
  }, 300);

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
      };

      const response = await clientAPI.createClient(clientData);
      
      if (response.data.warning) {
        // Similar clients found
        const confirm = window.confirm(
          `Similar clients found:\n${response.data.similar_clients
            .map((c) => c.client_name)
            .join('\n')}\n\nDo you still want to create this client?`
        );
        
        if (!confirm) {
          return;
        }
        
        // Create anyway
        const finalResponse = await clientAPI.createClient(clientData);
        const newClient = finalResponse.data.data;
        setClients([...clients, newClient]);
        
        // ✅ AUTO-SET THE NEW CLIENT ID (now using correct formData)
        setFormData(prev => ({ ...prev, client_id: newClient.id.toString() }));
        console.log("✅ New client created! ID:", newClient.id, "Name:", newClient.client_name);
        console.log("✅ FormData updated with client_id:", newClient.id.toString());
        
        toast.success('Client created successfully');
      } else {
        const newClient = response.data.data;
        setClients([...clients, newClient]);
        
        // ✅ AUTO-SET THE NEW CLIENT ID (now using correct formData)
        setFormData(prev => ({ ...prev, client_id: newClient.id.toString() }));
        console.log("✅ New client created! ID:", newClient.id, "Name:", newClient.client_name);
        console.log("✅ FormData updated with client_id:", newClient.id.toString());
        
        toast.success('Client created successfully');
      }
      
      setShowClientModal(false);
      setNewClientName('');
    } catch (error) {
      console.error('Failed to create client:', error);
      toast.error('Failed to create client');
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // NEW: Validate services first
    if (!validateServices()) {
      return;
    }

    setLoading(true);
    setHasUnsavedChanges(false);

    try {
      // Validate services
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
          bill_date: formData.bill_date.toISOString().split('T')[0],
          payment_term_id: parseInt(formData.payment_term_id),
          client_id: formData.client_id ? parseInt(formData.client_id) : null,
          notes: formData.notes,
          services: services.map((s) => ({
            particulars_id: parseInt(s.particulars_id),
            particulars_other: s.particulars_other,
            service_date: s.service_date,
            service_year: s.service_year,
            amount: parseFloat(s.amount),
            gst_rate_id: parseInt(s.gst_rate_id),
          })),
        };

        await billAPI.updateBill(editBillId, billData);
        
        // NEW: Show animation
        setShowSuccessAnimation(true);
        setTimeout(() => {
          toast.success('Bill updated successfully!');
          setShowSuccessAnimation(false);
          navigate('/print-bill');
        }, 1000);
      } else {
        // CREATE new bill
        const billData = {
          header_id: parseInt(formData.header_id),
          bill_date: formData.bill_date.toISOString().split('T')[0],
          payment_term_id: parseInt(formData.payment_term_id),
          client_id: formData.client_id ? parseInt(formData.client_id) : null,
          notes: formData.notes,
          services: services.map((s) => ({
            particulars_id: parseInt(s.particulars_id),
            particulars_other: s.particulars_other,
            service_date: s.service_date,
            service_year: s.service_year,
            amount: parseFloat(s.amount),
            gst_rate_id: parseInt(s.gst_rate_id),
          })),
        };

        const response = await billAPI.createBill(billData);
        
        // NEW: Show animation
        setShowSuccessAnimation(true);
        setTimeout(() => {
          toast.success(`Bill ${response.data.data.bill_no} created successfully!`);
          setShowSuccessAnimation(false);
          navigate('/print-bill', { state: { billNo: response.data.data.bill_no } });
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to save bill:', error);
      toast.error(error.response?.data?.message || 'Failed to save bill');
    } finally {
      setLoading(false);
    }
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
      <h1 className="text-3xl font-bold text-gray-900 mb-6"> {editMode ? 'Edit Bill (DRAFT)' : 'Services Form'}</h1>

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
                onChange={(value) => setFormData({ ...formData, header_id: value })}
                options={headerOptions}
                placeholder="Select Company"
                disabled={editMode}
                required
              />

              {/* Bill Number Preview */}
              {billNumberPreview && !editMode && (
                <div className="flex items-center space-x-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <Eye className="w-4 h-4 text-blue-600" />
                  <div>
                    <p className="text-xs text-blue-600 font-medium">Next Bill Number</p>
                    <p className="text-sm font-bold text-blue-900">{billNumberPreview}</p>
                  </div>
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  FY: {getFinancialYear(formData.bill_date)}
                </p>
              </div>

              {/* Client Name */}
              <SearchableDropdown
                label="Client Name (Optional)"
                value={formData.client_id}
                onChange={(value) => setFormData({ ...formData, client_id: value })}
                options={clientOptions}
                placeholder="Search client..."
                onSearch={handleSearchClients}
                allowCreate
                onCreate={handleCreateClient}
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
                  <td colSpan="7" className="px-4 py-3 text-right">
                    Subtotal:
                  </td>
                  <td className="px-4 py-3 text-right">{formatCurrency(totals.subtotal)}</td>
                  <td></td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan="7" className="px-4 py-3 text-right">
                    GST Total:
                  </td>
                  <td className="px-4 py-3 text-right">{formatCurrency(totals.gstTotal)}</td>
                  <td></td>
                  <td></td>
                </tr>
                <tr className="text-lg">
                  <td colSpan="7" className="px-4 py-3 text-right">
                    Total Invoice Value:
                  </td>
                  <td className="px-4 py-3 text-right text-primary-600">
                    {formatCurrency(totals.total)}
                  </td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-5 h-5" />
              <span>
                {loading 
                  ? (editMode ? 'Updating Bill...' : 'Creating Bill...')
                  : (editMode ? 'Update Bill' : 'Create Bill')
                }
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Success Animation */}
      {showSuccessAnimation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center animate-bounce">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      )}

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
                Contact Person <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="contact_person"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Enter contact person name"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                name="phone"
                required
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
                GSTIN <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="gstin"
                required
                pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}"
                maxLength={15}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="27AABCU9603R1ZM"
              />
              <p className="text-xs text-gray-500 mt-1">15 characters (e.g., 27AABCU9603R1ZM)</p>
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

      {/* Success Animation */}
      {showSuccessAnimation && <SuccessCheckmark onComplete={() => setShowSuccessAnimation(false)} />}
    </div>
  );
};

export default ServicesFormPage;