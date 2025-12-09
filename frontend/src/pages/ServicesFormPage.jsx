import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Save } from 'lucide-react';
import toast from 'react-hot-toast';
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
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editBillId, setEditBillId] = useState(null);

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

  const loadMasterData = async () => {
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
    }
  };

  // Load bill data if editing
  useEffect(() => {
    if (location.state?.editBill) {
      const bill = location.state.editBill;
      setEditMode(true);
      setEditBillId(bill.id);
      
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
          id: s.id, // Keep service ID for deletion tracking
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
  }, [location.state]);

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

  // const handleSearchClients = debounce(async (searchTerm) => {
  //   try {
  //     const response = await clientAPI.searchClients(searchTerm);
  //     setClients(response.data.data);
  //   } catch (error) {
  //     console.error('Failed to search clients:', error);
  //   }
  // }, 300);
  const handleSearchClients = debounce(async (searchTerm) => {
  if (!searchTerm || searchTerm.length < 2) return;
  
  try {
    const response = await clientAPI.searchClients(searchTerm);
    setClients(response.data.data);
  } catch (error) {
    console.error('Failed to search clients:', error);
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
        
        toast.success('Client created successfully');
      } else {
        const newClient = response.data.data;
        setClients([...clients, newClient]);
        
        // ✅ AUTO-SET THE NEW CLIENT ID (now using correct formData)
        setFormData(prev => ({ ...prev, client_id: newClient.id.toString() }));
        
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
    setLoading(true);

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

        const response = await billAPI.updateBill(editBillId, billData);
        toast.success('Bill updated successfully!');
        navigate('/print-bill', { state: { billNo: response.data.data.bill_no } });
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
        toast.success(`Bill ${response.data.data.bill_no} created successfully!`);
        navigate('/print-bill', { state: { billNo: response.data.data.bill_no } });
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
  const clientOptions = clients.map((c) => ({ value: c.id, label: c.client_name }));
  const gstRateOptions = gstRates.map((g) => ({
    value: g.id,
    label: `${g.rate_percentage}% - ${g.description}`,
    rate: g.rate_percentage,
  }));
  const paymentTermOptions = paymentTerms.map((p) => ({ value: p.id, label: p.term_name }));

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-6"> {editMode ? 'Edit Bill (DRAFT)' : 'Services Form'}</h1>

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
              label="Client Name"
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

      {/* New Client Modal */}
      <Modal
        isOpen={showClientModal}
        onClose={() => {
          setShowClientModal(false);
          setNewClientName('');
        }}
        title="Add New Client"
      >
        <form onSubmit={handleSaveNewClient} className="space-y-4">
          <div>
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contact Person
            </label>
            <input
              type="text"
              name="contact_person"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              name="phone"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              name="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="flex justify-end space-x-3 mt-6">
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
    </div>
  );
};

export default ServicesFormPage;