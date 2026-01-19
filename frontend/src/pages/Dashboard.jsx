// import { useEffect, useState } from 'react';
// import { billAPI } from '../services/api';
// import { FileText, TrendingUp, IndianRupee, Clock } from 'lucide-react';
// import { formatCurrency, formatDate } from '../utils/helpers';
// import toast from 'react-hot-toast';

// const Dashboard = () => {
//   const [stats, setStats] = useState({
//     totalBills: 0,
//     draftBills: 0,
//     finalizedBills: 0,
//     totalRevenue: 0,
//   });
//   const [recentBills, setRecentBills] = useState([]);
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     fetchDashboardData();
//   }, []);

//   const fetchDashboardData = async () => {
//     try {
//       const response = await billAPI.getAllBills({ limit: 10 });
//       const bills = response.data.data;

//       // Calculate stats
//       const totalBills = bills.length;
//       const draftBills = bills.filter((b) => b.status === 'DRAFT').length;
//       const finalizedBills = bills.filter((b) => b.status === 'FINALIZED').length;
//       const totalRevenue = bills.reduce((sum, b) => sum + parseFloat(b.total_invoice_value || 0), 0);

//       setStats({ totalBills, draftBills, finalizedBills, totalRevenue });
//       setRecentBills(bills);
//       setLoading(false);
//     } catch (error) {
//       console.error('Failed to fetch dashboard data:', error);
//       toast.error('Failed to load dashboard data');
//       setLoading(false);
//     }
//   };

//   const statCards = [
//     {
//       title: 'Total Bills',
//       value: stats.totalBills,
//       icon: FileText,
//       color: 'bg-blue-500',
//     },
//     {
//       title: 'Draft Bills',
//       value: stats.draftBills,
//       icon: Clock,
//       color: 'bg-yellow-500',
//     },
//     {
//       title: 'Finalized Bills',
//       value: stats.finalizedBills,
//       icon: TrendingUp,
//       color: 'bg-green-500',
//     },
//     {
//       title: 'Total Revenue',
//       value: formatCurrency(stats.totalRevenue),
//       icon: IndianRupee,
//       color: 'bg-purple-500',
//     },
//   ];

//   if (loading) {
//     return (
//       <div className="flex items-center justify-center h-screen">
//         <div className="spinner"></div>
//       </div>
//     );
//   }

//   return (
//     <div className="p-6">
//       <h1 className="text-3xl font-bold text-gray-900 mb-6">Dashboard</h1>

//       {/* Stats Grid */}
//       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
//         {statCards.map((stat, index) => (
//           <div key={index} className="bg-white rounded-lg shadow p-6">
//             <div className="flex items-center justify-between">
//               <div>
//                 <p className="text-sm font-medium text-gray-600">{stat.title}</p>
//                 <p className="text-2xl font-bold text-gray-900 mt-2">{stat.value}</p>
//               </div>
//               <div className={`${stat.color} rounded-full p-3`}>
//                 <stat.icon className="w-6 h-6 text-white" />
//               </div>
//             </div>
//           </div>
//         ))}
//       </div>

//       {/* Recent Bills */}
//       <div className="bg-white rounded-lg shadow">
//         <div className="p-6 border-b">
//           <h2 className="text-xl font-semibold text-gray-900">Recent Bills</h2>
//         </div>
//         <div className="overflow-x-auto">
//           <table className="w-full">
//             <thead className="bg-gray-50">
//               <tr>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
//                   Bill No
//                 </th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
//                   Company
//                 </th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
//                   Created By
//                 </th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
//                   Date
//                 </th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
//                   Amount
//                 </th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
//                   Status
//                 </th>
//               </tr>
//             </thead>
//             <tbody className="bg-white divide-y divide-gray-200">
//               {recentBills.map((bill) => (
//                 <tr key={bill.id} className="hover:bg-gray-50">
//                   <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
//                     {bill.bill_no}
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
//                     {bill.company_name}
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
//                     {bill.created_by_name}
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
//                     {formatDate(bill.bill_date)}
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
//                     {formatCurrency(bill.total_invoice_value)}
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap">
//                     <span
//                       className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
//                         bill.status === 'DRAFT'
//                           ? 'bg-yellow-100 text-yellow-800'
//                           : bill.status === 'FINALIZED'
//                           ? 'bg-green-100 text-green-800'
//                           : 'bg-gray-100 text-gray-800'
//                       }`}
//                     >
//                       {bill.status}
//                     </span>
//                   </td>
//                 </tr>
//               ))}
//             </tbody>
//           </table>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default Dashboard;

import { useEffect, useState } from 'react';
import { FileText, TrendingUp, IndianRupee, Clock, Download } from 'lucide-react';
import { formatCurrency, formatDate, getFinancialYear } from '../utils/helpers';
import toast from 'react-hot-toast';
import api from '../services/api';
import Dropdown from '../components/common/Dropdown';
import DatePicker from 'react-datepicker';

const Dashboard = () => {
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
      if (filters.financial_year) params.financial_year = filters.financial_year;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.header_id) params.header_id = filters.header_id;
      if (filters.client_id) params.client_id = filters.client_id;
      if (filters.payment_status) params.payment_status = filters.payment_status;

      const response = await api.get('/reports/export-bills', { params });
      
      // Convert to CSV
      const bills = response.data.data.bills;
      const totals = response.data.data.totals;
      
      const csvHeaders = ['Bill No', 'Date', 'Company', 'Client', 'Amount', 'Paid', 'Balance', 'Status', 'Payment Status'];
      const csvRows = bills.map(bill => [
        bill.bill_no,
        formatDate(bill.bill_date),
        bill.company_name,
        bill.client_name || 'N/A',
        bill.total_invoice_value,
        bill.total_paid || 0,
        bill.balance,
        bill.status,
        bill.payment_status || 'UNPAID'
      ]);
      
      // Add totals row
      csvRows.push([
        '',
        '',
        '',
        'TOTAL',
        totals.total_billed,
        totals.total_paid,
        totals.total_balance,
        '',
        ''
      ]);

      const csv = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.join(','))
      ].join('\n');

      // Download
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bills-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
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
    },
    {
      title: 'Payment Received',
      value: formatCurrency(kpis.summary.total_paid),
      icon: TrendingUp,
      color: 'bg-green-500',
    },
    {
      title: 'Payment Receivable',
      value: formatCurrency(kpis.summary.total_outstanding),
      icon: IndianRupee,
      color: 'bg-red-500',
    },
    {
      title: 'Collection Rate',
      value: `${kpis.summary.collection_rate}%`,
      icon: Clock,
      color: 'bg-purple-500',
    },
  ];

  // Financial year options
  const fyOptions = [];
  const currentYear = new Date().getFullYear();
  for (let i = currentYear - 3; i <= currentYear + 1; i++) {
    const fy = `${i}-${String(i + 1).slice(-2)}`;
    fyOptions.push({ value: fy, label: `FY ${fy}` });
  }

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
      <div className="flex items-center justify-center h-screen">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <button
          onClick={handleExportExcel}
          className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          <Download className="w-4 h-4" />
          <span>Export to Excel</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Dropdown
            label="Financial Year"
            value={filters.financial_year}
            onChange={(value) => setFilters({ ...filters, financial_year: value })}
            options={fyOptions}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date From
            </label>
            <DatePicker
              selected={filters.date_from ? new Date(filters.date_from) : null}
              onChange={(date) => setFilters({ ...filters, date_from: date?.toISOString().split('T')[0] || '' })}
              dateFormat="dd/MM/yyyy"
              placeholderText="Select from date"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              isClearable
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date To
            </label>
            <DatePicker
              selected={filters.date_to ? new Date(filters.date_to) : null}
              onChange={(date) => setFilters({ ...filters, date_to: date?.toISOString().split('T')[0] || '' })}
              dateFormat="dd/MM/yyyy"
              placeholderText="Select to date"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              isClearable
            />
          </div>

          <Dropdown
            label="Month"
            value={filters.month}
            onChange={(value) => setFilters({ ...filters, month: value })}
            options={monthOptions}
          />

          <Dropdown
            label="Year"
            value={filters.year}
            onChange={(value) => setFilters({ ...filters, year: value })}
            options={yearOptions}
          />

          <Dropdown
            label="Company"
            value={filters.header_id}
            onChange={(value) => setFilters({ ...filters, header_id: value })}
            options={companyOptions}
          />

          <Dropdown
            label="Client"
            value={filters.client_id}
            onChange={(value) => setFilters({ ...filters, client_id: value })}
            options={clientOptions}
          />

          <Dropdown
            label="Payment Status"
            value={filters.payment_status}
            onChange={(value) => setFilters({ ...filters, payment_status: value })}
            options={paymentStatusOptions}
          />
        </div>
        <div className="flex justify-end space-x-3 mt-4">
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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((stat, index) => (
          <div key={index} className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">{stat.value}</p>
              </div>
              <div className={`${stat.color} rounded-full p-3`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Company-wise Breakdown */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Company-wise Receivables</h2>
        </div>
        <div className="overflow-x-auto">
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
        </div>
      </div>

      {/* Client-wise Breakdown */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Top 10 Client Receivables</h2>
        </div>
        <div className="overflow-x-auto">
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
            <div className="bg-yellow-50 rounded-lg p-4">
              <p className="text-xs text-yellow-600 font-medium mb-1">0-30 Days</p>
              <p className="text-2xl font-bold text-yellow-900">
                {formatCurrency(kpis.aging_analysis['0-30'] || 0)}
              </p>
            </div>
            <div className="bg-orange-50 rounded-lg p-4">
              <p className="text-xs text-orange-600 font-medium mb-1">31-60 Days</p>
              <p className="text-2xl font-bold text-orange-900">
                {formatCurrency(kpis.aging_analysis['31-60'] || 0)}
              </p>
            </div>
            <div className="bg-red-50 rounded-lg p-4">
              <p className="text-xs text-red-600 font-medium mb-1">61-90 Days</p>
              <p className="text-2xl font-bold text-red-900">
                {formatCurrency(kpis.aging_analysis['61-90'] || 0)}
              </p>
            </div>
            <div className="bg-rose-50 rounded-lg p-4">
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
