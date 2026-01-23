import { useState } from 'react';
import Modal from './Modal';
import toast from 'react-hot-toast';
import { clientAPI } from '../../services/api';

const ClientFormModal = ({ isOpen, onClose, onClientCreated, initialName = '' }) => {
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    const formData = new FormData(e.target);
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

    try {
      const response = await clientAPI.createClient(clientData);
      toast.success('Client created successfully');
      onClientCreated(response.data.data);
      onClose();
    } catch (error) {
      console.error('Failed to create client:', error);
      toast.error(error.response?.data?.message || 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Client"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Client Name - Full Width */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Client Name <span className="text-red-500">*</span>
          </label>
          <input 
            type="text" 
            name="client_name" 
            defaultValue={initialName}
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
                  placeholder="Mumbai"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <input 
                  type="text" 
                  name="state" 
                  placeholder="Maharashtra"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label>
                <input 
                  type="text" 
                  name="pincode" 
                  pattern="[0-9]{6}" 
                  maxLength={6}
                  placeholder="400001"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" 
                />
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
          <button 
            type="button" 
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            disabled={saving}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center space-x-2"
          >
            {saving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Client</span>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ClientFormModal;