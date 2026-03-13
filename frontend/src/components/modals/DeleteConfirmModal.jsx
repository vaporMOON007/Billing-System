import { AlertCircle, Trash2 } from 'lucide-react';
import Modal from '../common/Modal';

const DeleteConfirmModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  itemType,
  itemName,
  itemId,
  loading = false 
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Delete ${itemType}`}
      size="md"
    >
      <div className="space-y-4">
        {/* Warning Banner */}
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-900">Warning: This action cannot be undone</p>
              <p className="text-sm text-red-700 mt-1">
                This will permanently delete this {itemType.toLowerCase()} from the system.
              </p>
            </div>
          </div>
        </div>

        {/* Item Details */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Item to be Deleted</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-gray-600">ID:</div>
            <div className="font-semibold text-gray-900">{itemId}</div>
            
            <div className="text-gray-600">{itemType} Name:</div>
            <div className="font-semibold text-gray-900">{itemName}</div>
          </div>
        </div>

        {/* Confirmation Question */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800 font-medium">
            Are you sure you want to permanently delete this {itemType.toLowerCase()}?
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3 pt-4 border-t">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center space-x-2 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            <span>{loading ? 'Deleting...' : 'Delete Permanently'}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default DeleteConfirmModal;