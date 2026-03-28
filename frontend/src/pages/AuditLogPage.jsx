import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList, RefreshCw, Search, ChevronDown, ChevronRight,
  FileText, User,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { activityLogAPI, userAPI } from '../services/api';

// ─── Action config ────────────────────────────────────────────────────────────
const ACTION_META = {
  CREATE_BILL:     { label: 'Created bill',    dot: 'bg-indigo-400' },
  UPDATE_BILL:     { label: 'Updated bill',    dot: 'bg-blue-400' },
  FINALIZE_BILL:   { label: 'Finalized bill',  dot: 'bg-green-500' },
  DELETE_BILL:     { label: 'Deleted bill',    dot: 'bg-red-400' },
  ADD_SERVICE:     { label: 'Added service',   dot: 'bg-teal-400' },
  DELETE_SERVICE:  { label: 'Deleted service', dot: 'bg-orange-400' },
  MARK_PAYMENT:    { label: 'Marked payment',  dot: 'bg-emerald-500' },
  MERGE_BILLS:     { label: 'Merged bills',    dot: 'bg-fuchsia-500' },
  UNMERGE_BILL:    { label: 'Unmerged bill',   dot: 'bg-fuchsia-300' },
  WRITE_OFF_BILL:  { label: 'Write-off applied', dot: 'bg-orange-500' },
  CREATE_USER:     { label: 'Created user',    dot: 'bg-purple-400' },
  UPDATE_USER:     { label: 'Updated user',    dot: 'bg-violet-400' },
  RESET_PASSWORD:  { label: 'Reset password',  dot: 'bg-amber-400' },
  BULK_IMPORT_CLIENTS: { label: 'Bulk import', dot: 'bg-blue-500' },
  BULK_DELETE_CLIENTS: { label: 'Bulk delete', dot: 'bg-red-600' },
};

const actionLabel  = (a) => ACTION_META[a]?.label  || a;
const actionDot    = (a) => ACTION_META[a]?.dot    || 'bg-gray-400';

// ─── Format helpers ───────────────────────────────────────────────────────────
const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};
const fmtTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
};
const fmtDateTime = (iso) => iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : '—';

// ─── Single expandable bill card ──────────────────────────────────────────────
function BillLogCard({ group }) {
  const [open, setOpen] = useState(false);

  // Summary of unique actions in this bill
  const actionSummary = [...new Set(group.entries.map(e => e.action))];

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden mb-3 bg-white shadow-sm">
      {/* Header row — always visible */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        {/* Chevron */}
        <span className="text-gray-400 flex-shrink-0">
          {open
            ? <ChevronDown  className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
        </span>

        {/* Bill number */}
        <span className="font-mono font-semibold text-gray-800 text-sm min-w-[130px]">
          {group.bill_no || (group.bill_id ? `DRAFT-${group.bill_id}` : 'Unknown')}
        </span>

        {/* Action chips */}
        <div className="flex flex-wrap gap-1.5 flex-1">
          {actionSummary.map(a => (
            <span key={a} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              <span className={`w-1.5 h-1.5 rounded-full ${actionDot(a)}`} />
              {actionLabel(a)}
            </span>
          ))}
        </div>

        {/* Count */}
        <span className="text-xs text-gray-400 flex-shrink-0 mr-2">
          {group.entry_count} {group.entry_count === 1 ? 'entry' : 'entries'}
        </span>

        {/* Last activity */}
        <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
          Last: {fmtDateTime(group.last_activity)}
        </span>
      </button>

      {/* Expanded entries */}
      {open && (
        <div className="border-t border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap w-44">Date &amp; Time</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap w-40">User</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap w-36">Action</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {group.entries.map((entry, idx) => (
                <tr key={entry.id || idx} className="hover:bg-indigo-50/30 transition-colors">
                  {/* Date & Time */}
                  <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                    <div>{fmtDate(entry.created_at)}</div>
                    <div className="text-gray-400">{fmtTime(entry.created_at)}</div>
                  </td>

                  {/* User */}
                  <td className="px-5 py-3 whitespace-nowrap">
                    {entry.performed_by_name ? (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-indigo-600">
                            {entry.performed_by_name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-700">{entry.performed_by_name}</p>
                          <p className="text-[10px] text-gray-400">{entry.performed_by_username}</p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">System</span>
                    )}
                  </td>

                  {/* Action */}
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${actionDot(entry.action)}`} />
                      {actionLabel(entry.action)}
                    </span>
                  </td>

                  {/* Detail */}
                  <td className="px-5 py-3 text-xs text-gray-600 max-w-xs">
                    {entry.description || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── "Other activity" row (user management, etc.) ─────────────────────────────
function OtherActivityRow({ entry }) {
  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
        <div>{fmtDate(entry.created_at)}</div>
        <div className="text-gray-400">{fmtTime(entry.created_at)}</div>
      </td>
      <td className="px-5 py-3 whitespace-nowrap">
        {entry.performed_by_name ? (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-purple-600">
                {entry.performed_by_name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-700">{entry.performed_by_name}</p>
              <p className="text-[10px] text-gray-400">{entry.performed_by_username}</p>
            </div>
          </div>
        ) : (
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <User className="w-3 h-3" /> System
          </span>
        )}
      </td>
      <td className="px-5 py-3 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${actionDot(entry.action)}`} />
          {actionLabel(entry.action)}
        </span>
      </td>
      <td className="px-5 py-3 text-xs text-gray-600">{entry.description || '—'}</td>
    </tr>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function AuditLogPage() {
  const [billGroups, setBillGroups] = useState([]);
  const [other,      setOther]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [users,      setUsers]      = useState([]);

  // filters
  const [userId,   setUserId]   = useState('');
  const [billNo,   setBillNo]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const [search,   setSearch]   = useState('');

  useEffect(() => {
    userAPI.getAllUsers()
      .then(res => setUsers(res.data.data))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (userId)   params.user_id   = userId;
      if (billNo)   params.bill_no   = billNo;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = dateTo;
      if (search)   params.search    = search;

      const res = await activityLogAPI.getActivityLogByBill(params);
      setBillGroups(res.data.bill_groups);
      setOther(res.data.other);
    } catch {
      toast.error('Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [userId, billNo, dateFrom, dateTo, search]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => load();
  const resetFilters = () => {
    setUserId(''); setBillNo(''); setDateFrom(''); setDateTo(''); setSearch('');
    setTimeout(load, 50);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-indigo-100 rounded-lg">
          <ClipboardList className="w-6 h-6 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500">Full history of every change — grouped by bill</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
        {/* User */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">User</label>
          <select value={userId} onChange={e => setUserId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 min-w-[160px]">
            <option value="">All Users</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
            ))}
          </select>
        </div>

        {/* Bill No */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Bill No.</label>
          <input type="text" placeholder="e.g. INV/2425/011"
            value={billNo} onChange={e => setBillNo(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyFilters()}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 w-40" />
        </div>

        {/* From */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>

        {/* To */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>

        {/* Keyword */}
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Keyword</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="e.g. Audit Fees, payment"
              value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyFilters()}
              className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
        </div>

        <button onClick={applyFilters}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
          Apply
        </button>
        <button onClick={resetFilters}
          className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Reset
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* ── Bill Activity ─────────────────────────────────────────── */}
          <div className="mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-700">
              Bill Activity
              <span className="ml-2 text-gray-400 font-normal">
                {billGroups.length} bill{billGroups.length !== 1 ? 's' : ''}
              </span>
            </h2>
          </div>

          {billGroups.length === 0 ? (
            <div className="border border-gray-200 rounded-xl p-10 text-center mb-6 bg-white">
              <ClipboardList className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No bill activity found for these filters.</p>
            </div>
          ) : (
            <div className="mb-8">
              {billGroups.map(group => (
                <BillLogCard key={group.bill_no || group.bill_id} group={group} />
              ))}
            </div>
          )}

          {/* ── Other Activity (user management, etc.) ────────────────── */}
          {other.length > 0 && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <User className="w-4 h-4 text-purple-500" />
                <h2 className="text-sm font-semibold text-gray-700">
                  Other Activity
                  <span className="ml-2 text-gray-400 font-normal">{other.length} entr{other.length === 1 ? 'y' : 'ies'}</span>
                </h2>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {['Date & Time', 'User', 'Action', 'Detail'].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {other.map((entry, idx) => (
                      <OtherActivityRow key={entry.id || idx} entry={entry} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
