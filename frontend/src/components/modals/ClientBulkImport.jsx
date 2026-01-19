import { useState } from 'react';
import { X, Upload, Download, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Papa from 'papaparse';

const ClientBulkImport = ({ isOpen, onClose, onImportComplete }) => {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setResults(null);
    } else {
      toast.error('Please select a valid CSV file');
    }
  };

  const handleDownloadSample = () => {
    const sampleCSV = `Client Name,Contact Person,Phone,Email,GSTIN,Address Line 1,Address Line 2,City,State,Pincode
ABC Corp,John Doe,9876543210,john@abc.com,27AABCU9603R1ZM,123 Main St,Suite 400,Mumbai,Maharashtra,400001
XYZ Ltd,Jane Smith,9876543211,jane@xyz.com,27AADCX1234E1Z5,456 Park Ave,,Pune,Maharashtra,411001`;

    const blob = new Blob([sampleCSV], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'client-import-sample.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    toast.success('Sample CSV downloaded');
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }

    setImporting(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const clients = results.data.map((row) => ({
            client_name: row['Client Name']?.trim(),
            contact_person: row['Contact Person']?.trim(),
            phone: row['Phone']?.trim(),
            email: row['Email']?.trim(),
            gstin: row['GSTIN']?.trim(),
            address_line1: row['Address Line 1']?.trim(),
            address_line2: row['Address Line 2']?.trim(),
            city: row['City']?.trim(),
            state: row['State']?.trim(),
            pincode: row['Pincode']?.trim()
          }));

          const response = await fetch('/api/clients/bulk-import', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ clients })
          });

          const data = await response.json();

          if (data.success) {
            setResults(data.data);
            toast.success(data.message);
            if (data.data.imported > 0) {
              onImportComplete();
            }
          } else {
            toast.error(data.message);
          }
        } catch (error) {
          console.error('Import error:', error);
          toast.error('Failed to import clients');
        } finally {
          setImporting(false);
        }
      },
      error: (error) => {
        console.error('CSV parse error:', error);
        toast.error('Failed to parse CSV file');
        setImporting(false);
      }
    });
  };

  const handleClose = () => {
    setFile(null);
    setResults(null);
    setShowDetails(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl transform transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <Upload className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900">Bulk Import Clients</h3>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {!results ? (
              <>
                {/* Instructions */}
                <div className="bg-blue-50 rounded-lg p-4 mb-6">
                  <h4 className="text-sm font-semibold text-blue-900 mb-2">Instructions:</h4>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• Upload a CSV file with client information</li>
                    <li>• Required columns: Client Name, Contact Person, Phone, GSTIN</li>
                    <li>• Optional columns: Email, Address Line 1, Address Line 2, City, State, Pincode</li>
                    <li>• Phone must be 10 digits</li>
                    <li>• GSTIN must be 15 characters in valid format</li>
                    <li>• Duplicate client names will be skipped</li>
                  </ul>
                </div>

                {/* Download Sample */}
                <div className="mb-6">
                  <button
                    onClick={handleDownloadSample}
                    className="flex items-center space-x-2 text-primary-600 hover:text-primary-700 font-medium"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Sample CSV</span>
                  </button>
                </div>

                {/* File Upload */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Upload CSV File
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  {file && (
                    <p className="mt-2 text-sm text-gray-600">
                      Selected: {file.name}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex justify-end space-x-3">
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={!file || importing}
                    className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {importing ? 'Importing...' : 'Upload & Import'}
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Results Summary */}
                <div className="mb-6">
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-green-50 rounded-lg p-4">
                      <p className="text-xs text-green-600 font-medium mb-1">Successfully Imported</p>
                      <p className="text-2xl font-bold text-green-900">{results.imported}</p>
                    </div>
                    <div className="bg-yellow-50 rounded-lg p-4">
                      <p className="text-xs text-yellow-600 font-medium mb-1">Skipped (Duplicates)</p>
                      <p className="text-2xl font-bold text-yellow-900">{results.duplicates.length}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-4">
                      <p className="text-xs text-red-600 font-medium mb-1">Failed (Errors)</p>
                      <p className="text-2xl font-bold text-red-900">{results.errors.length}</p>
                    </div>
                  </div>

                  {/* Show Details Toggle */}
                  {(results.duplicates.length > 0 || results.errors.length > 0) && (
                    <button
                      onClick={() => setShowDetails(!showDetails)}
                      className="text-primary-600 hover:text-primary-700 font-medium text-sm"
                    >
                      {showDetails ? 'Hide Details ▲' : 'Show Details ▼'}
                    </button>
                  )}
                </div>

                {/* Details */}
                {showDetails && (
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {/* Errors */}
                    {results.errors.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-red-900 mb-2 flex items-center">
                          <AlertCircle className="w-4 h-4 mr-2" />
                          Failed Rows ({results.errors.length})
                        </h4>
                        <div className="bg-red-50 rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-red-100">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-red-900">Row</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-red-900">Client Name</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-red-900">Error</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-red-200">
                              {results.errors.map((error, idx) => (
                                <tr key={idx}>
                                  <td className="px-3 py-2 text-red-900">{error.row}</td>
                                  <td className="px-3 py-2 text-red-900">{error.client_name}</td>
                                  <td className="px-3 py-2 text-red-700">{error.error}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Duplicates */}
                    {results.duplicates.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-yellow-900 mb-2">
                          Duplicate Clients (Skipped) ({results.duplicates.length})
                        </h4>
                        <div className="bg-yellow-50 rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-yellow-100">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-yellow-900">Row</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-yellow-900">Client Name</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-yellow-900">Existing ID</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-yellow-200">
                              {results.duplicates.map((dup, idx) => (
                                <tr key={idx}>
                                  <td className="px-3 py-2 text-yellow-900">{dup.row}</td>
                                  <td className="px-3 py-2 text-yellow-900">{dup.client_name}</td>
                                  <td className="px-3 py-2 text-yellow-700">#{dup.existing_id}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Close Button */}
                <div className="flex justify-end mt-6">
                  <button
                    onClick={handleClose}
                    className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientBulkImport;
