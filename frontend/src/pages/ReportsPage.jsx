import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart2, Building2, Users, TrendingUp, AlertCircle,
  IndianRupee, ChevronRight, Clock, Download
} from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { reportAPI, masterAPI } from '../services/api';
import api from '../services/api';
import { formatCurrency } from '../utils/helpers';

// ── small summary card ────────────────────────────────────────────────────
const KPICard = ({ icon: Icon, label, value, color }) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
    <div className={`p-3 rounded-xl ${color}`}>
      <Icon className="w-5 h-5 text-white" />
    </div>
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-0.5">{value}</p>
    </div>
  </div>
);

// ── section heading ───────────────────────────────────────────────────────
const SectionHead = ({ icon: Icon, title, count }) => (
  <div className="flex items-center gap-2 mb-3">
    <Icon className="w-5 h-5 text-indigo-500" />
    <h2 className="text-base font-semibold text-gray-800">{title}</h2>
    {count !== undefined && (
      <span className="ml-1 text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{count}</span>
    )}
  </div>
);

// ── status pill ───────────────────────────────────────────────────────────
const Pill = ({ label, color }) => (
  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>{label}</span>
);

// ═════════════════════════════════════════════════════════════════════════
export default function ReportsPage() {
  const navigate = useNavigate();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [headers, setHeaders] = useState([]);

  // filters
  const [fy,            setFy]            = useState('');
  const [dateFrom,      setDateFrom]      = useState('');
  const [dateTo,        setDateTo]        = useState('');
  const [onlyFinalized, setOnlyFinalized] = useState(false);
  const [clientSearch,  setClientSearch]  = useState('');

  // ── financial year options ───────────────────────────────────────────
  const fyOptions = (() => {
    const opts = [];
    const now = new Date();
    const curFyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    for (let i = 0; i < 3; i++) {
      const s = curFyStart - i;
      opts.push(`${s}-${String(s + 1).slice(-2)}`);
    }
    return opts;
  })();

  // ── load ─────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (fy)       params.financial_year = fy;
      if (dateFrom) params.date_from      = dateFrom;
      if (dateTo)   params.date_to        = dateTo;
      params.only_finalized = onlyFinalized ? 'true' : 'false';

      const [reportRes, headerRes] = await Promise.all([
        reportAPI.getReceivables(params),
        masterAPI.getAllHeaders(),
      ]);
      setData(reportRes.data.data);
      setHeaders(headerRes.data.data);
    } catch {
      toast.error('Failed to load report data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Export bills to Excel ─────────────────────────────────────────────
  const handleExportExcel = async () => {
    try {
      const params = {};
      if (fy)           params.financial_year = fy;
      if (dateFrom)     params.date_from      = dateFrom;
      if (dateTo)       params.date_to        = dateTo;
      if (onlyFinalized) params.status        = 'FINALIZED';

      const response = await api.get('/reports/export-bills', { params });
      const { bills, absorbed_bills, totals } = response.data.data;

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
            bill.bill_date  ? new Date(bill.bill_date)  : '',
            bill.due_date   ? new Date(bill.due_date)   : '',
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
                pmt.payment_mode            || '',
                pmt.utr                     || '',
                pmt.cheque_no               || '',
                pmt.cash_collected_by       || '',
                pmt.received_in_bank        || '',
                pmt.received_account_holder || '',
                pmt.received_account_number || '',
              ]);
            });
          } else {
            rows.push([...base, '', '', '', '', '', '', '', '', '']);
          }
        });
        return rows;
      };

      const mainRows  = billsToRows(bills);
      const totalsRow = [
        'TOTAL', '', '', '', '',
        totals.total_billed, totals.total_paid, totals.total_balance,
        '', '', '', '', '', '', '', '', '', '', ''
      ];
      const mainData  = [HEADERS, ...mainRows, totalsRow];
      const mainSheet = XLSX.utils.aoa_to_sheet(mainData);
      mainSheet['!cols'] = [
        { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 26 },
        { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
        { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 14 },
        { wch: 20 }, { wch: 22 }, { wch: 22 }, { wch: 20 },
      ];

      const absorbedRows = billsToRows(absorbed_bills || []);
      const absorbedData = [HEADERS, ...(absorbedRows.length ? absorbedRows : [['No absorbed bills in this period']])];
      const absorbedSheet = XLSX.utils.aoa_to_sheet(absorbedData);
      absorbedSheet['!cols'] = mainSheet['!cols'];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, mainSheet,     'Bills');
      XLSX.utils.book_append_sheet(wb, absorbedSheet, 'Absorbed Bills');
      XLSX.writeFile(wb, `bills-export-${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Exported successfully');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data');
    }
  };

  // ── navigate to Print Bill with filter pre-applied ───────────────────
  const goToCompany = (headerId) => {
    navigate('/print-bill', { state: { filter: { header_id: headerId, status: onlyFinalized ? 'FINALIZED' : '' } } });
  };

  const goToClient = (clientId) => {
    navigate('/print-bill', { state: { filter: { client_id: clientId, status: onlyFinalized ? 'FINALIZED' : '' } } });
  };

  const fmt = (n) => formatCurrency(parseFloat(n || 0));

  // ── render ────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <BarChart2 className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
            <p className="text-sm text-gray-500">Receivables, collections, and aging analysis</p>
          </div>
        </div>
        <button
          onClick={handleExportExcel}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium"
        >
          <Download className="w-4 h-4" />
          Download Reports
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Financial Year</label>
          <select value={fy} onChange={e => setFy(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="">All Years</option>
            {fyOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <button onClick={load}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
          Apply
        </button>
        <button onClick={() => { setFy(''); setDateFrom(''); setDateTo(''); setOnlyFinalized(false); setTimeout(load, 50); }}
          className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors">
          Reset
        </button>
        {/* Only Finalized toggle */}
        <button
          type="button"
          onClick={() => setOnlyFinalized(f => !f)}
          className={`flex items-center gap-2.5 px-4 py-2 rounded-lg border-2 font-semibold text-sm transition-all select-none ${
            onlyFinalized
              ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
              : 'bg-white border-gray-300 text-gray-600 hover:border-indigo-400 hover:text-indigo-600'
          }`}
        >
          <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors flex-shrink-0 ${onlyFinalized ? 'bg-white/30' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${onlyFinalized ? 'translate-x-4' : 'translate-x-0'}`} />
          </span>
          Only Finalized
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : !data ? null : (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <KPICard icon={IndianRupee}  label="Total Billed"      value={fmt(data.summary?.total_billed)}      color="bg-indigo-500" />
            <KPICard icon={TrendingUp}   label="Total Collected"   value={fmt(data.summary?.total_collected)}   color="bg-green-500"  />
            <KPICard icon={AlertCircle}  label="Total Outstanding" value={fmt(data.summary?.total_outstanding)} color="bg-red-500"    />
            <KPICard icon={BarChart2}    label="Total Bills"       value={data.summary?.total_bills || 0}       color="bg-amber-500"  />
          </div>

          {/* ── Two-column layout: company + client ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">

            {/* Company-wise */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 pt-5 pb-3">
                <SectionHead icon={Building2} title="Company-wise Receivables" count={data.by_company?.length} />
                <p className="text-xs text-gray-400 mb-3">Click a company name to see its bills in Print Bill</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-y border-gray-100">
                    <tr>
                      {['Company', 'Bills', 'Billed', 'Collected', 'Outstanding'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-50">
                    {(data.by_company || []).length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No data</td></tr>
                    ) : (data.by_company || []).map(row => (
                      <tr key={row.header_id} className="hover:bg-indigo-50 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => goToCompany(row.header_id)}
                            className="text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 text-left"
                          >
                            {row.company_name}
                            <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                          </button>
                          <div className="flex gap-1 mt-0.5">
                            {row.unpaid_count  > 0 && <Pill label={`${row.unpaid_count} unpaid`}  color="bg-red-100 text-red-600" />}
                            {row.partial_count > 0 && <Pill label={`${row.partial_count} partial`} color="bg-yellow-100 text-yellow-700" />}
                            {row.paid_count    > 0 && <Pill label={`${row.paid_count} paid`}      color="bg-green-100 text-green-700" />}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{row.bill_count}</td>
                        <td className="px-4 py-3 text-gray-700">{fmt(row.total_billed)}</td>
                        <td className="px-4 py-3 text-green-700">{fmt(row.total_collected)}</td>
                        <td className="px-4 py-3 font-semibold text-red-600">{fmt(row.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Client-wise */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 pt-5 pb-3">
                <SectionHead icon={Users} title="Client-wise Receivables" count={data.by_client?.length} />
                <div className="flex items-center gap-3 mb-3">
                  <p className="text-xs text-gray-400 flex-1">Click a client name to see their bills in Print Bill</p>
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Filter by client name..."
                    className="w-56 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-y border-gray-100">
                    <tr>
                      {['Client', 'Bills', 'Billed', 'Collected', 'Outstanding'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(data.by_client || []).filter(row =>
                      !clientSearch || row.client_name?.toLowerCase().includes(clientSearch.toLowerCase())
                    ).length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No data</td></tr>
                    ) : (data.by_client || []).filter(row =>
                      !clientSearch || row.client_name?.toLowerCase().includes(clientSearch.toLowerCase())
                    ).map(row => (
                      <tr key={row.client_id} className="hover:bg-indigo-50 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => goToClient(row.client_id)}
                            className="text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 text-left"
                          >
                            {row.client_name}
                            <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                          </button>
                          <div className="flex gap-1 mt-0.5">
                            {row.unpaid_count  > 0 && <Pill label={`${row.unpaid_count} unpaid`}  color="bg-red-100 text-red-600" />}
                            {row.partial_count > 0 && <Pill label={`${row.partial_count} partial`} color="bg-yellow-100 text-yellow-700" />}
                            {row.paid_count    > 0 && <Pill label={`${row.paid_count} paid`}      color="bg-green-100 text-green-700" />}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{row.bill_count}</td>
                        <td className="px-4 py-3 text-gray-700">{fmt(row.total_billed)}</td>
                        <td className="px-4 py-3 text-green-700">{fmt(row.total_collected)}</td>
                        <td className="px-4 py-3 font-semibold text-red-600">{fmt(row.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Aging Analysis ── */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 mb-6">
            <SectionHead icon={Clock} title="Outstanding by Age (Overdue Bills)" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
              {[
                { label: '0 – 30 days',  key: '0_30',   color: 'border-yellow-400 bg-yellow-50' },
                { label: '31 – 60 days', key: '31_60',  color: 'border-orange-400 bg-orange-50' },
                { label: '61 – 90 days', key: '61_90',  color: 'border-red-400 bg-red-50' },
                { label: '90+ days',     key: '90_plus',color: 'border-red-700 bg-red-100' },
              ].map(bucket => (
                <div key={bucket.key} className={`border-l-4 rounded-lg p-4 ${bucket.color}`}>
                  <p className="text-xs text-gray-500 font-medium mb-1">{bucket.label}</p>
                  <p className="text-lg font-bold text-gray-800">{fmt(data.aging?.[bucket.key])}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Monthly Summary ── */}
          {(data.monthly || []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 pt-5 pb-3">
                <SectionHead icon={TrendingUp} title="Monthly Collection Summary (Last 12 Months)" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-y border-gray-100">
                    <tr>
                      {['Month', 'Billed', 'Collected', 'Outstanding'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.monthly.map(row => (
                      <tr key={row.month_sort} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-700">{row.month_label}</td>
                        <td className="px-4 py-3 text-gray-700">{fmt(row.billed)}</td>
                        <td className="px-4 py-3 text-green-700">{fmt(row.collected)}</td>
                        <td className="px-4 py-3 font-medium text-red-600">{fmt(row.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
