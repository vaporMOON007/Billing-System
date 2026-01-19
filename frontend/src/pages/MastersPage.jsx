import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { masterAPI } from '../services/api';
import Modal from '../components/common/Modal';
import ClientBulkImport from '../components/modals/ClientBulkImport';
import { useAuth } from '../context/AuthContext';

const MastersPage = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('particulars');
  const [particulars, setParticulars] = useState([]);
  const [gstRates, setGstRates] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showBulkImport, setShowBulkImport] = useState(false);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      switch (activeTab) {
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
      toast.error('Failed to save item');
    }
  };

  const tabs = [
    { id: 'company', label: 'Company Master', roles: ['CA'] },
    { id: 'particulars', label: 'Services (Particulars)' },
    { id: 'clients', label: 'Client Master' },
    { id: 'gst', label: 'GST Rates' },
    { id: 'payment', label: 'Payment Terms' },
  ].filter(tab => !tab.roles || tab.roles.includes(user?.role));

  return (
    <div className="p-6">
<div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Master Data Management</h1>
        <div className="flex space-x-3">
          {activeTab === 'clients' && (
            <button
              onClick={() => setShowBulkImport(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>Bulk Import</span>
            </button>
          )}
          <button
            onClick={handleAdd}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add New</span>
          </button>
        </div>
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
              {/* Particulars Table */}
              {activeTab === 'particulars' && (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Service Name
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {particulars.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.id}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.service_name}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button
                            onClick={() => handleEdit(item)}
                            className="text-primary-600 hover:text-primary-900 mr-4"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="text-red-600 hover:text-red-900"
                          >
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
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Rate (%)
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Description
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {gstRates.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {item.rate_percentage}%
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">{item.description}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button
                            onClick={() => handleEdit(item)}
                            className="text-primary-600 hover:text-primary-900 mr-4"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="text-red-600 hover:text-red-900"
                          >
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
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Term Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Days
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {paymentTerms.map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.term_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {item.days_to_add} days
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <button
                            onClick={() => handleEdit(item)}
                            className="text-primary-600 hover:text-primary-900 mr-4"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="text-red-600 hover:text-red-900"
                          >
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
        title={`${editingItem ? 'Edit' : 'Add'} ${
          activeTab === 'particulars'
            ? 'Service'
            : activeTab === 'gst'
            ? 'GST Rate'
            : 'Payment Term'
        }`}
        size="sm"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Particulars Form */}
          {activeTab === 'particulars' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Service Name <span className="text-red-500">*</span>
              </label>
              <textarea
                name="service_name"
                defaultValue={editingItem?.service_name}
                required
                rows="3"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}

          {/* GST Rate Form */}
          {activeTab === 'gst' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rate Percentage <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  name="rate_percentage"
                  defaultValue={editingItem?.rate_percentage}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  name="description"
                  defaultValue={editingItem?.description}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </>
          )}

          {/* Payment Terms Form */}
          {activeTab === 'payment' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Term Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="term_name"
                  defaultValue={editingItem?.term_name}
                  required
                  placeholder="e.g., Net 30 Days"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Days to Add <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="days_to_add"
                  defaultValue={editingItem?.days_to_add}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </>
          )}

          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              {editingItem ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Client Bulk Import Modal */}
      <ClientBulkImport
        isOpen={showBulkImport}
        onClose={() => setShowBulkImport(false)}
        onImportComplete={() => {
          loadData();
          setShowBulkImport(false);
        }}
      />
    </div>
  );
};

export default MastersPage;