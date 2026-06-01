import { useState } from 'react';
import { Upload, Download, X, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { clientAPI } from '../../services/api';
import Modal from '../common/Modal';
import { GSTIN_REGEX, PAN_REGEX } from '../../utils/helpers';

const ClientBulkImport = ({ isOpen, onClose, onImportComplete }) => {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);

  const downloadTemplate = () => {
    const template = [
      {
        'ID': '',
        'Client Name': 'ABC Corporation',
        'Contact Person': 'John Doe',
        'Phone': '9876543210',
        'Email': 'john@example.com',
        'GSTIN': '27AABCU9603R1ZM',
        'PAN': 'AABCU9603R',
        'Address Line 1': '123 Business Street',
        'Address Line 2': 'Near Market Square',
        'City': 'Mumbai',
        'State': 'Maharashtra',
        'Pincode': '400001'
      },
      {
        'ID': '',
        'Client Name': 'XYZ Enterprises',
        'Contact Person': 'Jane Smith',
        'Phone': '9123456789',
        'Email': 'jane@xyz.com',
        'GSTIN': '',
        'PAN': '',
        'Address Line 1': '456 Corporate Plaza',
        'Address Line 2': '',
        'City': 'Delhi',
        'State': 'Delhi',
        'Pincode': '110001'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clients');
    ws['!cols'] = [
      { wch: 8 },  // ID
      { wch: 25 }, // Client Name
      { wch: 20 }, // Contact Person
      { wch: 15 }, // Phone
      { wch: 25 }, // Email
      { wch: 18 }, // GSTIN
      { wch: 12 }, // PAN
      { wch: 30 }, // Address Line 1
      { wch: 30 }, // Address Line 2
      { wch: 15 }, // City
      { wch: 15 }, // State
      { wch: 10 }  // Pincode
    ];
    XLSX.writeFile(wb, 'client_import_template.xlsx');
    toast.success('Template downloaded successfully');
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      const validTypes = [
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ];
      if (!validTypes.includes(selectedFile.type) && !selectedFile.name.match(/\.(xlsx|xls)$/)) {
        toast.error('Please upload an Excel file (.xlsx or .xls)');
        return;
      }
      setFile(selectedFile);
      setResults(null);
    }
  };

  const validateRow = (row, index) => {
    const errors = [];
    if (!row['Client Name'] || row['Client Name'].toString().trim() === '') {
      errors.push(`Row ${index}: Client Name is required`);
    }
    if (row['Phone'] && row['Phone'].toString().trim() !== '') {
      const phone = row['Phone'].toString().replace(/[^0-9]/g, '');
      if (phone.length !== 10) {
        errors.push(`Row ${index}: Phone must be exactly 10 digits`);
      }
    }
    if (row['GSTIN'] && row['GSTIN'].toString().trim() !== '') {
      if (!GSTIN_REGEX.test(row['GSTIN'].toString().trim())) {
        errors.push(`Row ${index}: GSTIN format is invalid (e.g. 27AABCU9603R1ZM)`);
      }
    }
    if (row['PAN'] && row['PAN'].toString().trim() !== '') {
      if (!PAN_REGEX.test(row['PAN'].toString().trim())) {
        errors.push(`Row ${index}: PAN format is invalid (e.g. AABCU9603R)`);
      }
    }
    if (row['Email'] && row['Email'].toString().trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(row['Email'].toString().trim())) {
        errors.push(`Row ${index}: Invalid email format`);
      }
    }
    if (row['Pincode'] && row['Pincode'].toString().trim() !== '') {
      const pincode = row['Pincode'].toString().replace(/[^0-9]/g, '');
      if (pincode.length !== 6) {
        errors.push(`Row ${index}: Pincode must be exactly 6 digits`);
      }
    }
    return errors;
  };

  const handleImport = async () => {
    if (!file) { toast.error('Please select a file to import'); return; }
    setImporting(true);
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);

        if (jsonData.length === 0) {
          toast.error('The file is empty or has no valid data');
          setImporting(false);
          return;
        }

        const allErrors = [];
        jsonData.forEach((row, index) => {
          const errors = validateRow(row, index + 2);
          allErrors.push(...errors);
        });

        if (allErrors.length > 0) {
          setResults({ updated: 0, created: 0, failed: allErrors.length, errors: allErrors });
          setImporting(false);
          toast.error(`Validation failed. Please fix ${allErrors.length} error(s)`);
          return;
        }

        const clients = jsonData.map(row => ({
          id: row['ID'] ? parseInt(row['ID'].toString().trim()) : null,
          client_name: row['Client Name']?.toString().trim() || '',
          contact_person: row['Contact Person']?.toString().trim() || '',
          phone: row['Phone']?.toString().replace(/[^0-9]/g, '') || '',
          email: row['Email']?.toString().trim() || null,
          gstin: row['GSTIN']?.toString().trim() || null,
          pan: row['PAN']?.toString().trim() || null,
          address_line1: row['Address Line 1']?.toString().trim() || null,
          address_line2: row['Address Line 2']?.toString().trim() || null,
          city: row['City']?.toString().trim() || null,
          state: row['State']?.toString().trim() || null,
          pincode: row['Pincode']?.toString().replace(/[^0-9]/g, '') || null
        }));

        const response = await clientAPI.bulkImport({ clients });
        const resultData = response.data.data || {};

        const updatedCount = resultData.updated ?? 0;
        const createdCount = resultData.created ?? 0;
        const errorRows = resultData.errors ?? [];

        const errorMessages = errorRows.map(e => `Row ${e.row} (${e.client_name}): ${e.error}`);

        setResults({
          updated: updatedCount,
          created: createdCount,
          failed: errorRows.length,
          errors: errorMessages
        });

        if (errorRows.length === 0) {
          toast.success(`Import complete: ${updatedCount} updated, ${createdCount} created`);
          setTimeout(() => { onImportComplete(); }, 1500);
        } else {
          toast(`Import done: ${updatedCount} updated, ${createdCount} created, ${errorRows.length} failed`, { icon: '⚠️' });
        }
      } catch (error) {
        console.error('Import error:', error);
        toast.error(error.response?.data?.message || 'Failed to import clients');
        setResults({ updated: 0, created: 0, failed: 0, errors: [error.response?.data?.message || 'Import failed'] });
      } finally {
        setImporting(false);
      }
    };

    reader.onerror = () => { toast.error('Failed to read file'); setImporting(false); };
    reader.readAsArrayBuffer(file);
  };

  const handleClose = () => { setFile(null); setResults(null); onClose(); };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Bulk Import Clients" size="md">
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Import Instructions</h4>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>Download the Excel template below</li>
            <li><strong>Required fields:</strong> Client Name only</li>
            <li><strong>Optional fields:</strong> Contact Person, Phone, GSTIN, PAN, Email, Address, City, State, Pincode</li>
            <li><strong>ID column:</strong> Leave blank for new clients. Fill with existing ID to update that client. If an ID is provided but not found, that row will error.</li>
            <li>Upload the completed file and click Import</li>
          </ol>
        </div>

        <button onClick={downloadTemplate} className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
          <Download className="w-5 h-5" />
          <span>Download Excel Template</span>
        </button>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
          <input type="file" id="file-upload" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" />
          <label htmlFor="file-upload" className="flex flex-col items-center justify-center cursor-pointer">
            <Upload className="w-12 h-12 text-gray-400 mb-3" />
            <span className="text-sm font-medium text-gray-700 mb-1">{file ? file.name : 'Click to upload Excel file'}</span>
            <span className="text-xs text-gray-500">Supports .xlsx and .xls files</span>
          </label>
        </div>

        {results && (
          <div className="space-y-3">
            {(results.updated > 0 || results.created > 0) && (
              <div className="flex items-start space-x-2 bg-green-50 border border-green-200 rounded-lg p-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  {results.updated > 0 && <p className="text-sm font-medium text-green-900"><RefreshCw className="w-3 h-3 inline mr-1" />{results.updated} client(s) updated</p>}
                  {results.created > 0 && <p className="text-sm font-medium text-green-900">✓ {results.created} client(s) created</p>}
                </div>
              </div>
            )}
            {results.failed > 0 && (
              <div className="flex items-start space-x-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-900 mb-2">{results.failed} row(s) failed</p>
                  {results.errors && results.errors.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-y-auto">
                      <ul className="text-xs text-red-800 space-y-1">
                        {results.errors.map((error, index) => (
                          <li key={index} className="flex items-start"><span className="mr-2">•</span><span>{error}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <button onClick={handleClose} className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50" disabled={importing}>
            {(results?.updated > 0 || results?.created > 0) ? 'Close' : 'Cancel'}
          </button>
          <button onClick={handleImport} disabled={!file || importing} className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-2">
            {importing ? (<><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Importing...</span></>) : (<><Upload className="w-4 h-4" /><span>Import Clients</span></>)}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ClientBulkImport;
