import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { masterAPI, clientAPI } from '../services/api';
import Modal from '../components/common/Modal';

const MastersPage = () => {
  const [activeTab, setActiveTab] = useState('particulars');
  
  // Data states
  const [companies, setCompanies] = useState([]);
  const [clients, setClients] = useState([]);
  const [particulars, setParticulars] = useState([]);
  const [gstRates, setGstRates] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      switch (activeTab) {
        case 'company':
          const cRes = await masterAPI.getAllHeaders();
          setCompanies(cRes.data.data);
          break;
        case 'clients':
          const clRes = await clientAPI.getAllClients();
          setClients(clRes.data.data);
          break;
        case 'particulars':
          const pRes = await masterAPI.getAllParticulars();
          setParticulars(pRes.data.data);
          break;
        case 'gst':
          const gRes = await masterAPI.getAllGSTRates();
          setGstRates(gRes.data.data);
          break;
        case 'payment':
          const ptRes = await masterAPI.getAllPaymentTerms();
          setPaymentTerms(ptRes.data.data);
          break;
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingItem(null);
    setShowModal(true);
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;

    try {
      switch (activeTab) {
        case 'company':
          await masterAPI.deleteHeader(id);
          break;
        case 'clients':
          await clientAPI.deleteClient(id);
          break;
        case 'particulars':
          await masterAPI.deleteParticular(id);
          break;
        case 'gst':
          await masterAPI.deleteGSTRate(id);
          break;
        case 'payment':
          await masterAPI.deletePaymentTerm(id);
          break;
      }
      toast.success('Item deleted successfully');
      loadData();
    } catch (error) {
      console.error('Failed to delete:', error);
      toast.error('Failed to delete item');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);

    try {
      switch (activeTab) {
        case 'company':
          const companyData = {
            company_name: formData.get('company_name'),
            proprietor_name: formData.get('proprietor_name'),
            address_line1: formData.get('address_line1'),
            address_line2: formData.get('address_line2'),
            city: formData.get('city'),
            state: formData.get('state'),
            pincode: formData.get('pincode'),
            phone: formData.get('phone'),
            email: formData.get('email'),
            gstin: formData.get('gstin'),
            pan: formData.get('pan'),
            bill_prefix: formData.get('bill_prefix'),
            upi_id: formData.get('upi_id'),
            bank_name: formData.get('bank_name'),
            account_holder_name: formData.get('account_holder_name'),
            account_number: formData.get('account_number'),
            ifsc_code: formData.get('ifsc_code'),
            branch_name: formData.get('branch_name'),
          };
          if (editingItem) {
            await masterAPI.updateHeader(editingItem.id, companyData);
          } else {
            await masterAPI.createHeader(companyData);
          }
          break;

        case 'clients':
          const clientData = {
            client_name: formData.get('client_name'),
            contact_person: formData.get('contact_person'),
            phone: formData.get('phone'),
            email: formData.get('email') || null,
            gstin: formData.get('gstin'),
            address_line1: formData.get('address_line1') || null,
            address_line2: formData.get('address_line2') || null,
            city: formData.get('city') || null,
            state: formData.get('state') || null,
            pincode: formData.get('pincode') || null,
          };
          if (editingItem) {
            await clientAPI.updateClient(editingItem.id, clientData);
          } else {
            await clientAPI.createClient(clientData);
          }
          break;

        case 'particulars':
          const pData = { service_name: formData.get('service_name') };
          if (editingItem) {
            await masterAPI.updateParticular(editingItem.id, pData);
          } else {
            await masterAPI.createParticular(pData);
          }
          break;

        case 'gst':
          const gData = {
            rate_percentage: parseFloat(formData.get('rate_percentage')),
            description: formData.get('description'),
          };
          if (editingItem) {
            await masterAPI.updateGSTRate(editingItem.id, gData);
          } else {
            await masterAPI.createGSTRate(gData);
          }
          break;

        case 'payment':
          const ptData = {
            term_name: formData.get('term_name'),
            days_to_add: parseInt(formData.get('days_to_add')),
          };
          if (editingItem) {
            await masterAPI.updatePaymentTerm(editingItem.id, ptData);
          } else {
            await masterAPI.createPaymentTerm(ptData);
          }
          break;
      }
      toast.success(`Item ${editingItem ? 'updated' : 'created'} successfully`);
      setShowModal(false);
      loadData();
    } catch (error) {
      console.error('Failed to save:', error);
      toast.error(error.response?.data?.message || 'Failed to save item');
    }
  };

  const tabs = [
    { id: 'particulars', label: 'Services (Particulars)' },
    { id: 'gst', label: 'GST Rates' },
    { id: 'payment', label: 'Payment Terms' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Master Data Management</h1>
        <button
          onClick={handleAdd}
          className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Add New</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="spinner"></div>
            </div>
          ) : (
            <>
              {/* Company Master Table */}
              {activeTab === 'company' && (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Proprietor</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">GSTIN</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {companies.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.id}</td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.company_name}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.proprietor_name}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.gstin}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.phone}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button onClick={() => handleEdit(item)} className="text-primary-600 hover:text-primary-900 mr-4">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-900">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Client Master Table */}
              {activeTab === 'clients' && (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contact Person</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">GSTIN</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {clients.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.id}</td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.client_name}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.contact_person}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.phone}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.gstin}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.email || '-'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button onClick={() => handleEdit(item)} className="text-primary-600 hover:text-primary-900 mr-4">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-900">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Particulars Table */}
              {activeTab === 'particulars' && (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Service Name</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {particulars.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.id}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.service_name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button onClick={() => handleEdit(item)} className="text-primary-600 hover:text-primary-900 mr-4">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-900">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* GST Rates Table */}
              {activeTab === 'gst' && (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate (%)</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {gstRates.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.id}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.rate_percentage}%</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.description}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button onClick={() => handleEdit(item)} className="text-primary-600 hover:text-primary-900 mr-4">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-900">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Payment Terms Table */}
              {activeTab === 'payment' && (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Term Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Days</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {paymentTerms.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.id}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.term_name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.days_to_add} days</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button onClick={() => handleEdit(item)} className="text-primary-600 hover:text-primary-900 mr-4">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-900">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={`${editingItem ? 'Edit' : 'Add New'} ${
          activeTab === 'company' ? 'Company' :
          activeTab === 'clients' ? 'Client' :
          activeTab === 'particulars' ? 'Service' :
          activeTab === 'gst' ? 'GST Rate' : 'Payment Term'
        }`}
        size={activeTab === 'company' || activeTab === 'clients' ? 'lg' : 'sm'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Company Form */}
          {activeTab === 'company' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input type="text" name="company_name" defaultValue={editingItem?.company_name} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Proprietor Name <span className="text-red-500">*</span></label>
                  <input type="text" name="proprietor_name" defaultValue={editingItem?.proprietor_name} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bill Prefix</label>
                  <input type="text" name="bill_prefix" defaultValue={editingItem?.bill_prefix} maxLength={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="ABC" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone <span className="text-red-500">*</span></label>
                  <input type="tel" name="phone" defaultValue={editingItem?.phone} required pattern="[0-9]{10}" maxLength={10}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email <span className="text-red-500">*</span></label>
                  <input type="email" name="email" defaultValue={editingItem?.email} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">GSTIN <span className="text-red-500">*</span></label>
                  <input type="text" name="gstin" defaultValue={editingItem?.gstin} required maxLength={15}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PAN <span className="text-red-500">*</span></label>
                  <input type="text" name="pan" defaultValue={editingItem?.pan} required maxLength={10}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1 <span className="text-red-500">*</span></label>
                  <input type="text" name="address_line1" defaultValue={editingItem?.address_line1} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
                  <input type="text" name="address_line2" defaultValue={editingItem?.address_line2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City <span className="text-red-500">*</span></label>
                  <input type="text" name="city" defaultValue={editingItem?.city} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State <span className="text-red-500">*</span></label>
                  <input type="text" name="state" defaultValue={editingItem?.state} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pincode <span className="text-red-500">*</span></label>
                  <input type="text" name="pincode" defaultValue={editingItem?.pincode} required pattern="[0-9]{6}" maxLength={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">UPI ID</label>
                  <input type="text" name="upi_id" defaultValue={editingItem?.upi_id}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              </div>

              {/* Bank Details Section */}
              <div className="pt-4 border-t">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Bank Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name <span className="text-red-500">*</span></label>
                    <input type="text" name="bank_name" defaultValue={editingItem?.bank_name} required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Holder <span className="text-red-500">*</span></label>
                    <input type="text" name="account_holder_name" defaultValue={editingItem?.account_holder_name} required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Number <span className="text-red-500">*</span></label>
                    <input type="text" name="account_number" defaultValue={editingItem?.account_number} required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">IFSC Code <span className="text-red-500">*</span></label>
                    <input type="text" name="ifsc_code" defaultValue={editingItem?.ifsc_code} required maxLength={11}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Branch Name <span className="text-red-500">*</span></label>
                    <input type="text" name="branch_name" defaultValue={editingItem?.branch_name} required
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Client Form - EXACT LAYOUT FROM IMAGE */}
          {activeTab === 'clients' && (
            <>
              <div className="space-y-4">
                {/* Client Name - Full Width */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Client Name <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text" 
                    name="client_name" 
                    defaultValue={editingItem?.client_name} 
                    required
                    placeholder="Enter client name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                  />
                </div>

                {/* Contact Person | Phone - Side by Side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Contact Person <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      name="contact_person" 
                      defaultValue={editingItem?.contact_person} 
                      required
                      placeholder="Enter contact person name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="tel" 
                      name="phone" 
                      defaultValue={editingItem?.phone} 
                      required 
                      pattern="[0-9]{10}" 
                      maxLength={10}
                      placeholder="10 digit phone number"
                      onInput={(e) => {
                        e.target.value = e.target.value.replace(/[^0-9]/g, '');
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                    />
                  </div>
                </div>

                {/* Email | GSTIN - Side by Side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email
                    </label>
                    <input 
                      type="email" 
                      name="email" 
                      defaultValue={editingItem?.email}
                      placeholder="email@example.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      GSTIN <span className="text-red-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      name="gstin" 
                      defaultValue={editingItem?.gstin} 
                      required
                      pattern="[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}"
                      maxLength={15}
                      placeholder="27AABCU9603R1ZM"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                    />
                    <p className="text-xs text-gray-500 mt-1">15 characters (e.g., 27AABCU9603R1ZM)</p>
                  </div>
                </div>

                {/* Address Details (Optional) - Section Header */}
                <div className="pt-4 border-t">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Address Details (Optional)</h4>
                  <div className="space-y-3">
                    {/* Address Line 1 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Address Line 1
                      </label>
                      <input 
                        type="text" 
                        name="address_line1" 
                        defaultValue={editingItem?.address_line1}
                        placeholder="Building/Street"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                      />
                    </div>

                    {/* Address Line 2 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Address Line 2
                      </label>
                      <input 
                        type="text" 
                        name="address_line2" 
                        defaultValue={editingItem?.address_line2}
                        placeholder="Area/Landmark"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                      />
                    </div>

                    {/* City | State | Pincode - 3 Columns */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                        <input 
                          type="text" 
                          name="city" 
                          defaultValue={editingItem?.city}
                          placeholder="Mumbai"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                        <input 
                          type="text" 
                          name="state" 
                          defaultValue={editingItem?.state}
                          placeholder="Maharashtra"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label>
                        <input 
                          type="text" 
                          name="pincode" 
                          defaultValue={editingItem?.pincode} 
                          pattern="[0-9]{6}" 
                          maxLength={6}
                          placeholder="400001"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Particulars Form */}
          {activeTab === 'particulars' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Service Name <span className="text-red-500">*</span></label>
              <textarea name="service_name" defaultValue={editingItem?.service_name} required rows="3"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
          )}

          {/* GST Rate Form */}
          {activeTab === 'gst' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rate Percentage <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" name="rate_percentage" defaultValue={editingItem?.rate_percentage} required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input type="text" name="description" defaultValue={editingItem?.description}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </>
          )}

          {/* Payment Terms Form */}
          {activeTab === 'payment' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Term Name <span className="text-red-500">*</span></label>
                <input type="text" name="term_name" defaultValue={editingItem?.term_name} required placeholder="e.g., Net 30 Days"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Days to Add <span className="text-red-500">*</span></label>
                <input type="number" name="days_to_add" defaultValue={editingItem?.days_to_add} required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </>
          )}

          <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
              {editingItem ? 'Update' : 'Save Client'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default MastersPage;