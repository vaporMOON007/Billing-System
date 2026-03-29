import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, TrendingUp, IndianRupee, Clock, Plus } from 'lucide-react';
import { formatCurrency, formatDate, getFinancialYear, getYearOptions } from '../utils/helpers';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import api from '../services/api';
import Dropdown from '../components/common/Dropdown';
import DatePicker from 'react-datepicker';
import { CardSkeleton } from '../components/common/SkeletonLoader';
import EmptyState from '../components/common/EmptyState';

const Dashboard = () => {
  const navigate = useNavigate();
  
  const [kpis, setKpis] = useState({
    summary: {
      total_bills: 0,
      total_billed: 0,
      total_paid: 0,
      total_outstanding: 0,
      collection_rate: 0
    },
    by_company: [],
    by_client: [],
    aging_analysis: {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0
    }
  });
  
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [clients, setClients] = useState([]);
  
  // Get current financial year
  const getCurrentFY = () => {
    const today = new Date();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    return month >= 4 
      ? `${year}-${String(year + 1).slice(-2)}`
      : `${year - 1}-${String(year).slice(-2)}`;
  };

  const [onlyFinalized, setOnlyFinalized] = useState(false);

  const [filters, setFilters] = useState({
    financial_year: getCurrentFY(),
    date_from: '',
    date_to: '',
    month: '',
    year: '',
    header_id: '',
    client_id: '',
    payment_status: ''
  });

  useEffect(() => {
    loadMasterData();
    loadDashboardData();
  }, []);

  const loadMasterData = async () => {
    try {
      const [companiesRes, clientsRes] = await Promise.all([
        api.get('/masters/headers'),
        api.get('/clients')
      ]);
      setCompanies(companiesRes.data.data);
      setClients(clientsRes.data.data);
    } catch (error) {
      console.error('Failed to load master data:', error);
    }
  };

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const params = {};
      
      if (filters.financial_year) params.financial_year = filters.financial_year;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.month) params.month = filters.month;
      if (filters.year) params.year = filters.year;
      if (filters.header_id) params.header_id = filters.header_id;
      if (filters.client_id) params.client_id = filters.client_id;
      if (filters.payment_status) params.payment_status = filters.payment_status;
      params.only_finalized = onlyFinalized ? 'true' : 'false';

      const response = await api.get('/reports/dashboard-kpis', { params });
      setKpis(response.data.data);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilters = () => {
    loadDashboardData();
  };

  const handleClearFilters = () => {
    setOnlyFinalized(false);
    setFilters({
      financial_year: getCurrentFY(),
      date_from: '',
      date_to: '',
      month: '',
      year: '',
      header_id: '',
      client_id: '',
      payment_status: ''
    });
  };

  const handleExportExcel = async () => {
    try {
      const params = {};
      if (filters.financial_year)  params.financial_year  = filters.financial_year;
      if (filters.date_from)       params.date_from       = filters.date_from;
      if (filters.date_to)         params.date_to         = filters.date_to;
      if (filters.header_id)       params.header_id       = filters.header_id;
      if (filters.client_id)       params.client_id       = filters.client_id;
      if (filters.payment_status)  params.payment_status  = filters.payment_status;

      const response = await api.get('/reports/export-bills', { params });
      const { bills, absorbed_bills, totals } = response.data.data;

      // ── helper: flatten bills array into worksheet rows ──────────────
      const HEADERS = [
        'Bill No', 'Bill Date', 'Due Date', 'Company', 'Client',
        'Invoice Amount', 'Total Paid', 'Balance', 'Bill Status', 'Payment Status',
        'Payment Date', 'Payment Amount', 'Payment Mode',
        'UTR / Ref No', 'Cheque No', 'Collected By',
        'Received In Bank', 'Account Holder', 'Account Number'
      ];

      const billsToRows = (billList) => {
        const rows = [];
        billList.forEach(bill => {
          const base = [
            bill.bill_no,
            bill.bill_date    ? new Date(bill.bill_date)    : '',
            bill.due_date     ? new Date(bill.due_date)     : '',
            bill.company_name || '',
            bill.client_name  || '',
            parseFloat(bill.total_invoice_value) || 0,
            parseFloat(bill.total_paid || 0),
            parseFloat(bill.balance)   || 0,
            bill.status,
            bill.payment_status || 'UNPAID',
          ];
          if (bill.payments && bill.payments.length > 0) {
            bill.payments.forEach(pmt => {
              rows.push([
                ...base,
                pmt.payment_date ? new Date(pmt.payment_date) : '',
                parseFloat(pmt.amount_paid) || 0,
                pmt.payment_mode              || '',
                pmt.utr                       || '',
                pmt.cheque_no                 || '',
                pmt.cash_collected_by         || '',
                pmt.received_in_bank          || '',
                pmt.received_account_holder   || '',
                pmt.received_account_number   || '',
              ]);
            });
          } else {
            rows.push([...base, '', '', '', '', '', '', '', '', '']);
          }
        });
        return rows;
      };

      // ── Build main sheet ─────────────────────────────────────────────
      const mainRows   = billsToRows(bills);
      const totalsRow  = [
        'TOTAL', '', '', '', '',
        totals.total_billed, totals.total_paid, totals.total_balance,
        '', '', '', '', '', '', '', '', '', '', ''
      ];
      const mainData   = [HEADERS, ...mainRows, totalsRow];
      const mainSheet  = XLSX.utils.aoa_to_sheet(mainData);

      // Date format for date columns (B, C, K = indices 1, 2, 10)
      const dateFmt = 'dd/mm/yyyy';
      const dateColIndices = [1, 2, 10];
      const numFmt   = '#,##0.00';
      const amtColIndices = [5, 6, 7, 11];

      // Apply column widths
      mainSheet['!cols'] = [
        { wch: 16 }, // Bill No
        { wch: 12 }, // Bill Date
        { wch: 12 }, // Due Date
        { wch: 22 }, // Company
        { wch: 26 }, // Client
        { wch: 14 }, // Invoice
        { wch: 12 }, // Paid
        { wch: 12 }, // Balance
        { wch: 12 }, // Status
        { wch: 14 }, // Payment Status
        { wch: 12 }, // Pmt Date
        { wch: 14 }, // Pmt Amount
        { wch: 12 }, // Mode
        { wch: 20 }, // UTR
        { wch: 14 }, // Cheque
        { wch: 20 }, // Collected By
        { wch: 22 }, // Bank
        { wch: 22 }, // Account Holder
        { wch: 20 }, // Account Number
      ];

      // Format cells
      const range = XLSX.utils.decode_range(mainSheet['!ref'] || 'A1');
      for (let R = 1; R <= range.e.r; R++) {
        dateColIndices.forEach(C => {
          const cell = mainSheet[XLSX.utils.encode_cell({ r: R, c: C })];
          if (cell && cell.t === 'd') cell.z = dateFmt;
        });
        amtColIndices.forEach(C => {
          const cell = mainSheet[XLSX.utils.encode_cell({ r: R, c: C })];
          if (cell && cell.t === 'n') cell.z = numFmt;
        });
      }

      // Bold header row
      for (let C = 0; C <= HEADERS.length - 1; C++) {
        const cell = mainSheet[XLSX.utils.encode_cell({ r: 0, c: C })];
        if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '4F46E5' } } };
      }

      // ── Build absorbed sheet ─────────────────────────────────────────
      const absorbedRows = billsToRows(absorbed_bills || []);
      const absorbedData = [HEADERS, ...(absorbedRows.length ? absorbedRows : [['No absorbed bills in this period']])];
      const absorbedSheet = XLSX.utils.aoa_to_sheet(absorbedData);
      absorbedSheet['!cols'] = mainSheet['!cols'];

      // ── Assemble workbook ────────────────────────────────────────────
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, mainSheet,     'Bills');
      XLSX.utils.book_append_sheet(wb, absorbedSheet, 'Absorbed Bills');

      const filename = `bills-export-${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, filename);

      toast.success('Exported successfully');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data');
    }
  };

  const statCards = [
    {
      title: 'Total Billed',
      value: formatCurrency(kpis.summary.total_billed),
      icon: FileText,
      color: 'bg-blue-500',
      bgLight: 'bg-blue-100',
    },
    {
      title: 'Payment Received',
      value: formatCurrency(kpis.summary.total_paid),
      icon: TrendingUp,
      color: 'bg-green-500',
      bgLight: 'bg-green-100',
    },
    {
      title: 'Payment Receivable',
      value: formatCurrency(kpis.summary.total_outstanding),
      icon: IndianRupee,
      color: 'bg-red-500',
      bgLight: 'bg-red-100',
    },
    {
      title: 'Collection Rate',
      value: `${kpis.summary.collection_rate}%`,
      icon: Clock,
      color: 'bg-purple-500',
      bgLight: 'bg-purple-100',
    },
  ];

  // Financial year options — same range as ServiceRow (2018-19 → current FY)
  const currentYear = new Date().getFullYear();
  const fyOptions = [
    { value: '', label: 'All FYs' },
    ...getYearOptions().map(fy => ({ value: fy, label: fy }))
  ];

  // Month options
  const monthOptions = [
    { value: '', label: 'All Months' },
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  // Year options
  const yearOptions = [{ value: '', label: 'All Years' }];
  for (let i = currentYear - 5; i <= currentYear; i++) {
    yearOptions.push({ value: i.toString(), label: i.toString() });
  }

  const companyOptions = [
    { value: '', label: 'All Companies' },
    ...companies.map(c => ({ value: c.id, label: c.company_name }))
  ];

  const clientOptions = [
    { value: '', label: 'All Clients' },
    ...clients.map(c => ({ value: c.id, label: c.client_name }))
  ];

  const paymentStatusOptions = [
    { value: '', label: 'All Status' },
    { value: 'UNPAID', label: 'Unpaid' },
    { value: 'PARTIAL', label: 'Partial' },
    { value: 'PAID', label: 'Paid' },
  ];

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Welcome back! Here's what's happening today.</p>
        </div>
        <CardSkeleton count={4} />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">Welcome back! Here's what's happening today.</p>
      </div>

      {/* Quick Actions Bar */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => navigate('/services-form')}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Bill</span>
          </button>
          <button
            onClick={() => navigate('/print-bill')}
            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <IndianRupee className="w-4 h-4" />
            <span>Record Payment</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12">
            <Dropdown
              label="Financial Year"
              value={filters.financial_year}
              onChange={(value) => setFilters({ ...filters, financial_year: value })}
              options={fyOptions}
            />
          </div>

          <div className="col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date From
            </label>
            <DatePicker
              selected={filters.date_from ? new Date(filters.date_from) : null}
              onChange={(date) => setFilters({ ...filters, date_from: date?.toISOString().split('T')[0] || '' })}
              dateFormat="dd/MM/yyyy"
              placeholderText="Select from date"
              showMonthDropdown
              showYearDropdown
              dropdownMode="select"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              isClearable
            />
          </div>

          <div className="col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date To
            </label>
            <DatePicker
              selected={filters.date_to ? new Date(filters.date_to) : null}
              onChange={(date) => setFilters({ ...filters, date_to: date?.toISOString().split('T')[0] || '' })}
              dateFormat="dd/MM/yyyy"
              placeholderText="Select to date"
              showMonthDropdown
              showYearDropdown
              dropdownMode="select"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              isClearable
            />
          </div>

          <div className="col-span-3">
            <Dropdown
              label="Month"
              value={filters.month}
              onChange={(value) => setFilters({ ...filters, month: value })}
              options={monthOptions}
            />
          </div>

          <div className="col-span-3">
            <Dropdown
              label="Year"
              value={filters.year}
              onChange={(value) => setFilters({ ...filters, year: value })}
              options={yearOptions}
            />
          </div>

          <div className="col-span-4">
            <Dropdown
              label="Company"
              value={filters.header_id}
              onChange={(value) => setFilters({ ...filters, header_id: value })}
              options={companyOptions}
            />
          </div>

          <div className="col-span-4">
            <Dropdown
              label="Client"
              value={filters.client_id}
              onChange={(value) => setFilters({ ...filters, client_id: value })}
              options={clientOptions}
            />
          </div>

          <div className="col-span-4">
            <Dropdown
              label="Payment Status"
              value={filters.payment_status}
              onChange={(value) => setFilters({ ...filters, payment_status: value })}
              options={paymentStatusOptions}
            />
          </div>
        </div>
        <div className="flex items-center justify-between mt-4">
          {/* Only Finalized toggle */}
          <button
            type="button"
            onClick={() => setOnlyFinalized(f => !f)}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-lg border-2 font-semibold text-sm transition-all select-none ${
              onlyFinalized
                ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
                : 'bg-white border-gray-300 text-gray-600 hover:border-primary-500 hover:text-primary-600'
            }`}
          >
            <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors flex-shrink-0 ${onlyFinalized ? 'bg-white/30' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${onlyFinalized ? 'translate-x-4' : 'translate-x-0'}`} />
            </span>
            Only Finalized
          </button>
          <div className="flex space-x-3">
            <button
              onClick={handleClearFilters}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Clear Filters
            </button>
            <button
              onClick={handleApplyFilters}
              className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>

      {/* Enhanced Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow-md p-6 border-l-4 border-transparent hover:shadow-lg transition-shadow" style={{ borderLeftColor: stat.color.replace('bg-', '#') }}>
            <div className="flex items-center justify-between mb-4">
              <div className={`w-12 h-12 ${stat.bgLight} rounded-lg flex items-center justify-center`}>
                <stat.icon className={`w-6 h-6 ${stat.color.replace('bg-', 'text-')}`} />
              </div>
            </div>
            <h3 className="text-gray-600 text-sm font-medium mb-1">{stat.title}</h3>
            <p className="text-3xl font-bold text-gray-900 mb-2">{stat.value}</p>
            <p className="text-xs text-gray-500">Current period</p>
          </div>
        ))}
      </div>

      {/* Company-wise Breakdown */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Company-wise Receivables</h2>
        </div>
        <div className="overflow-x-auto">
          {kpis.by_company.length === 0 ? (
            <div className="py-12">
              <EmptyState
                type="default"
                title="No company data available"
                description="Data will appear here once bills are created for companies"
              />
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Company
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                    Bills
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Total Billed
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Paid
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Outstanding
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {kpis.by_company.map((company) => (
                  <tr key={company.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {company.company_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 text-center">
                      {company.bill_count}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium text-right">
                      {formatCurrency(company.total_billed)}
                    </td>
                    <td className="px-6 py-4 text-sm text-green-600 font-medium text-right">
                      {formatCurrency(company.total_paid)}
                    </td>
                    <td className="px-6 py-4 text-sm text-red-600 font-bold text-right">
                      {formatCurrency(company.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Client-wise Breakdown */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Top 10 Client Receivables</h2>
        </div>
        <div className="overflow-x-auto">
          {kpis.by_client.length === 0 ? (
            <div className="py-12">
              <EmptyState
                type="default"
                title="No client data available"
                description="Client receivables will appear here once bills are assigned to clients"
              />
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Client
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                    Bills
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Total Billed
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Paid
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Outstanding
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {kpis.by_client.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {client.client_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 text-center">
                      {client.bill_count}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium text-right">
                      {formatCurrency(client.total_billed)}
                    </td>
                    <td className="px-6 py-4 text-sm text-green-600 font-medium text-right">
                      {formatCurrency(client.total_paid)}
                    </td>
                    <td className="px-6 py-4 text-sm text-red-600 font-bold text-right">
                      {formatCurrency(client.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Aging Analysis */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Aging Analysis</h2>
          <p className="text-sm text-gray-500">Outstanding amounts by overdue period</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
              <p className="text-xs text-yellow-600 font-medium mb-1">0-30 Days</p>
              <p className="text-2xl font-bold text-yellow-900">
                {formatCurrency(kpis.aging_analysis['0-30'] || 0)}
              </p>
            </div>
            <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
              <p className="text-xs text-orange-600 font-medium mb-1">31-60 Days</p>
              <p className="text-2xl font-bold text-orange-900">
                {formatCurrency(kpis.aging_analysis['31-60'] || 0)}
              </p>
            </div>
            <div className="bg-red-50 rounded-lg p-4 border border-red-200">
              <p className="text-xs text-red-600 font-medium mb-1">61-90 Days</p>
              <p className="text-2xl font-bold text-red-900">
                {formatCurrency(kpis.aging_analysis['61-90'] || 0)}
              </p>
            </div>
            <div className="bg-rose-50 rounded-lg p-4 border border-rose-200">
              <p className="text-xs text-rose-600 font-medium mb-1">90+ Days</p>
              <p className="text-2xl font-bold text-rose-900">
                {formatCurrency(kpis.aging_analysis['90+'] || 0)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;