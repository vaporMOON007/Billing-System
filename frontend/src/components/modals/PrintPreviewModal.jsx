import React, { useState, useEffect } from 'react';
import { X, Download, Mail, Printer, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';

const PrintPreviewModal = ({ isOpen, onClose, bill, onDownload, onEmail, onPrint }) => {
  const [zoom, setZoom] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = 1; // Calculate based on bill content

  const zoomLevels = [50, 75, 100, 150, 200];

  const handleZoomIn = () => {
    const currentIndex = zoomLevels.indexOf(zoom);
    if (currentIndex < zoomLevels.length - 1) {
      setZoom(zoomLevels[currentIndex + 1]);
    }
  };

  const handleZoomOut = () => {
    const currentIndex = zoomLevels.indexOf(zoom);
    if (currentIndex > 0) {
      setZoom(zoomLevels[currentIndex - 1]);
    }
  };

  const handleDownload = () => {
    onDownload && onDownload();
    toast.success('Bill downloaded successfully');
  };

  const handleEmail = () => {
    onEmail && onEmail();
  };

  const handlePrint = () => {
    window.print();
    toast.success('Printing...');
  };

  if (!isOpen || !bill) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-75 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h2 className="text-xl font-semibold text-gray-900">
              Print Preview - {bill.bill_no}
            </h2>
            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {/* Zoom Controls */}
            <div className="flex items-center space-x-2 border rounded-lg px-2">
              <button
                onClick={handleZoomOut}
                disabled={zoom === zoomLevels[0]}
                className="p-2 hover:bg-gray-100 rounded disabled:opacity-50"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium min-w-[50px] text-center">
                {zoom}%
              </span>
              <button
                onClick={handleZoomIn}
                disabled={zoom === zoomLevels[zoomLevels.length - 1]}
                className="p-2 hover:bg-gray-100 rounded disabled:opacity-50"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {/* Page Navigation */}
            {totalPages > 1 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 hover:bg-gray-100 rounded disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 hover:bg-gray-100 rounded disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>Download</span>
            </button>

            <button
              onClick={handleEmail}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
            >
              <Mail className="w-4 h-4" />
              <span>Email</span>
            </button>

            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2"
            >
              <Printer className="w-4 h-4" />
              <span>Print</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Preview Content */}
        <div className="flex-1 overflow-auto bg-gray-200 p-8">
          <div
            className="mx-auto bg-white shadow-2xl"
            style={{
              width: `${8.5 * zoom}px`,
              minHeight: `${11 * zoom}px`,
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
            }}
          >
            {/* Bill Content - This should render the actual bill template */}
            <div className="p-8">
              {/* Header */}
              <div className="text-center mb-6">
                <h1 className="text-3xl font-bold text-gray-900">INVOICE</h1>
                <p className="text-lg text-gray-600 mt-2">{bill.bill_no}</p>
              </div>

              {/* Bill Details */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Bill To:</h3>
                  <p className="text-gray-700">{bill.client_name}</p>
                  <p className="text-gray-600 text-sm">{bill.client_address}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold">Date:</span> {new Date(bill.bill_date).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold">Due Date:</span> {new Date(bill.due_date).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* Services Table */}
              <table className="w-full mb-6">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="text-left p-2 text-sm">Description</th>
                    <th className="text-right p-2 text-sm">Amount</th>
                    <th className="text-right p-2 text-sm">GST</th>
                    <th className="text-right p-2 text-sm">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.services?.map((service, index) => (
                    <tr key={index} className="border-b">
                      <td className="p-2 text-sm">{service.particulars_name}</td>
                      <td className="text-right p-2 text-sm">₹{service.amount}</td>
                      <td className="text-right p-2 text-sm">₹{service.gst_amount}</td>
                      <td className="text-right p-2 text-sm">₹{service.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-64">
                  <div className="flex justify-between py-2 border-t">
                    <span className="font-semibold">Subtotal:</span>
                    <span>₹{bill.subtotal}</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="font-semibold">Total GST:</span>
                    <span>₹{bill.total_gst}</span>
                  </div>
                  <div className="flex justify-between py-3 border-t-2 border-gray-900">
                    <span className="text-lg font-bold">Total:</span>
                    <span className="text-lg font-bold">₹{bill.total_invoice_value}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintPreviewModal;