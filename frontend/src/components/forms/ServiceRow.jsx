import { Trash2 } from 'lucide-react';
import Dropdown from '../common/Dropdown';
import SearchableDropdown from '../common/SearchableDropdown';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { formatCurrency, getYearOptions } from '../../utils/helpers';

const ServiceRow = ({
  service,
  index,
  onChange,
  onRemove,
  particularsOptions,
  gstRatesOptions,
}) => {
  const yearOptions = getYearOptions().map((year) => ({
    value: year,
    label: year,
  }));

  const handleFieldChange = (field, value) => {
    onChange(index, { ...service, [field]: value });
  };

  return (
    <tr className="border-b hover:bg-gray-50">
      {/* Sr. No */}
      <td className="px-4 py-3 text-center font-medium text-gray-700">
        {index + 1}
      </td>

      {/* Particulars */}
      <td className="px-4 py-3">
        <Dropdown
          value={service.particulars_id}
          onChange={(value) => handleFieldChange('particulars_id', value)}
          options={particularsOptions}
          placeholder="Select Service"
          required
        />
        {service.particulars_id === '11' && (
          <input
            type="text"
            value={service.particulars_other || ''}
            onChange={(e) => handleFieldChange('particulars_other', e.target.value)}
            placeholder="Specify service..."
            className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
          />
        )}
      </td>

      {/* Date */}
      <td className="px-4 py-3">
        <DatePicker
          selected={service.service_date ? new Date(service.service_date) : null}
          onChange={(date) => handleFieldChange('service_date', date?.toISOString().split('T')[0])}
          dateFormat="dd/MM/yyyy"
          placeholderText="Select date"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </td>

      {/* Year */}
      <td className="px-4 py-3">
        <Dropdown
          value={service.service_year}
          onChange={(value) => handleFieldChange('service_year', value)}
          options={yearOptions}
          placeholder="Year"
          required
        />
      </td>

      {/* Amount */}
      <td className="px-4 py-3">
        <input
          type="number"
          step="0.01"
          value={service.amount || ''}
          onChange={(e) => handleFieldChange('amount', parseFloat(e.target.value) || 0)}
          placeholder="0.00"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          required
        />
      </td>

      {/* GST Rate */}
      <td className="px-4 py-3">
        <Dropdown
          value={service.gst_rate_id}
          onChange={(value) => handleFieldChange('gst_rate_id', value)}
          options={gstRatesOptions}
          placeholder="GST %"
          required
        />
      </td>

      {/* GST Amount (Auto-calculated) */}
      <td className="px-4 py-3 text-right font-medium text-gray-700">
        {service.amount && service.gst_rate_id ? (
          <>
            {formatCurrency(
              (service.amount *
                parseFloat(
                  gstRatesOptions.find((g) => g.value === service.gst_rate_id)?.rate || 0
                )) /
                100
            )}
          </>
        ) : (
          '₹0.00'
        )}
      </td>

      {/* Total (Auto-calculated) */}
      <td className="px-4 py-3 text-right font-bold text-gray-900">
        {service.amount && service.gst_rate_id ? (
          <>
            {formatCurrency(
              service.amount +
                (service.amount *
                  parseFloat(
                    gstRatesOptions.find((g) => g.value === service.gst_rate_id)?.rate || 0
                  )) /
                  100
            )}
          </>
        ) : (
          '₹0.00'
        )}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-center">
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-red-600 hover:text-red-800 transition-colors"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </td>
    </tr>
  );
};

export default ServiceRow;