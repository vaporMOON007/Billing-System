import { useState, useEffect } from 'react';
import { Users, Plus, Edit2, KeyRound, ToggleLeft, ToggleRight, X, Check, Shield, User, Clock, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { userAPI, passwordResetAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const ROLE_LABELS = { CA: 'CA', EMPLOYEE: 'Employee', SUPERADMIN: 'Super Admin' };
const ROLE_COLORS = {
  CA:         'bg-purple-100 text-purple-700',
  EMPLOYEE:   'bg-blue-100 text-blue-700',
  SUPERADMIN: 'bg-red-100 text-red-700',
};

// ── small modal shell ──────────────────────────────────────────────────────
const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  </div>
);

// ── field helper ──────────────────────────────────────────────────────────
const Field = ({ label, children }) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    {children}
  </div>
);

const Input = (props) => (
  <input
    {...props}
    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
  />
);

const Select = ({ value, onChange, children }) => (
  <select
    value={value}
    onChange={onChange}
    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
  >
    {children}
  </select>
);

// ═══════════════════════════════════════════════════════════════════════════
export default function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'SUPERADMIN';

  const [activeTab, setActiveTab]   = useState('users'); // 'users' | 'pending' | 'reset-requests'
  const [users, setUsers]           = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [resetRequests, setResetRequests] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // modal states
  const [editModal,   setEditModal]   = useState(null);  // user object
  const [resetModal,  setResetModal]  = useState(null);  // user object
  const [createModal, setCreateModal] = useState(false);

  // form states
  const [editForm,   setEditForm]   = useState({});
  const [resetForm,  setResetForm]  = useState({ newPassword: '', confirm: '' });
  const [createForm, setCreateForm] = useState({
    username: '', full_name: '', email: '', phone: '', role: 'EMPLOYEE', password: ''
  });
  const [saving, setSaving] = useState(false);

  // ── load ──────────────────────────────────────────────────────────────
  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await userAPI.getAllUsers();
      setUsers(res.data.data);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadPendingUsers = async () => {
    if (!isSuperAdmin) return;
    setPendingLoading(true);
    try {
      const res = await userAPI.getPendingUsers();
      setPendingUsers(res.data.data);
    } catch {
      toast.error('Failed to load pending users');
    } finally {
      setPendingLoading(false);
    }
  };

  const loadResetRequests = async () => {
    if (!isSuperAdmin) return;
    setResetLoading(true);
    try {
      const res = await passwordResetAPI.getPendingRequests();
      setResetRequests(res.data.data);
    } catch {
      toast.error('Failed to load reset requests');
    } finally {
      setResetLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    if (isSuperAdmin) {
      loadPendingUsers();
      loadResetRequests();
    }
  }, []);

  // ── open edit modal ───────────────────────────────────────────────────
  const openEdit = (u) => {
    setEditForm({ full_name: u.full_name, email: u.email, phone: u.phone || '', role: u.role });
    setEditModal(u);
  };

  // ── save edit ─────────────────────────────────────────────────────────
  const saveEdit = async () => {
    if (!editForm.full_name || !editForm.email) {
      return toast.error('Name and email are required');
    }
    setSaving(true);
    try {
      await userAPI.updateUser(editModal.id, editForm);
      toast.success('User updated');
      setEditModal(null);
      loadUsers();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  // ── toggle active ─────────────────────────────────────────────────────
  const toggleActive = async (u) => {
    const action = u.is_active ? 'deactivate' : 'activate';
    try {
      await userAPI.updateUser(u.id, { is_active: !u.is_active });
      toast.success(`User ${action}d`);
      loadUsers();
    } catch (e) {
      toast.error(e.response?.data?.message || `Failed to ${action} user`);
    }
  };

  // ── reset password ────────────────────────────────────────────────────
  const saveReset = async () => {
    if (resetForm.newPassword.length < 6) return toast.error('Password must be at least 6 characters');
    if (resetForm.newPassword !== resetForm.confirm) return toast.error('Passwords do not match');
    setSaving(true);
    try {
      await userAPI.adminResetPassword(resetModal.id, { newPassword: resetForm.newPassword });
      toast.success('Password reset successfully');
      setResetModal(null);
      setResetForm({ newPassword: '', confirm: '' });
    } catch (e) {
      toast.error(e.response?.data?.message || 'Reset failed');
    } finally {
      setSaving(false);
    }
  };

  // ── create user ───────────────────────────────────────────────────────
  const saveCreate = async () => {
    const { username, full_name, email, phone, role, password } = createForm;
    if (!username || !full_name || !email || !phone || !password) {
      return toast.error('All fields are required');
    }
    if (password.length < 6) return toast.error('Password must be at least 6 characters');
    setSaving(true);
    try {
      await userAPI.createUser({ username, full_name, email, phone, role, password });
      toast.success('User created successfully');
      setCreateModal(false);
      setCreateForm({ username: '', full_name: '', email: '', phone: '', role: 'EMPLOYEE', password: '' });
      loadUsers();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  // ── approve / reject password reset requests ─────────────────────────
  const approveResetRequest = async (req) => {
    try {
      await passwordResetAPI.approveRequest(req.id);
      toast.success(`Password reset approved for ${req.full_name}`);
      loadResetRequests();
      // Notify navbar badge
      window.dispatchEvent(new CustomEvent('resetRequestsChanged'));
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to approve request');
    }
  };

  const rejectResetRequest = async (req) => {
    if (!window.confirm(`Reject password reset request for ${req.full_name}?`)) return;
    try {
      await passwordResetAPI.rejectRequest(req.id);
      toast.success(`Password reset rejected for ${req.full_name}`);
      loadResetRequests();
      window.dispatchEvent(new CustomEvent('resetRequestsChanged'));
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to reject request');
    }
  };

  // ── approve / reject pending user ─────────────────────────────────────
  const notifyPendingChanged = () => {
    window.dispatchEvent(new CustomEvent('pendingUsersChanged'));
  };

  const approveUser = async (u) => {
    try {
      await userAPI.approveUser(u.id);
      toast.success(`${u.full_name} approved — they can now log in`);
      loadPendingUsers();
      loadUsers();
      notifyPendingChanged();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to approve user');
    }
  };

  const rejectUser = async (u) => {
    if (!window.confirm(`Reject and permanently delete ${u.full_name}'s registration request?`)) return;
    try {
      await userAPI.rejectUser(u.id);
      toast.success(`${u.full_name}'s registration has been rejected`);
      loadPendingUsers();
      notifyPendingChanged();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to reject user');
    }
  };

  // ── render ────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <Users className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
            <p className="text-sm text-gray-500">{users.length} user{users.length !== 1 ? 's' : ''} in the system</p>
          </div>
        </div>
        <button
          onClick={() => setCreateModal(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      {/* Tabs — only shown to SUPERADMIN */}
      {isSuperAdmin && (
        <div className="flex gap-1 mb-5 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'users'
                ? 'bg-white border border-b-white border-gray-200 text-indigo-600 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            All Users
          </button>
          <button
            onClick={() => { setActiveTab('pending'); loadPendingUsers(); }}
            className={`relative px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'pending'
                ? 'bg-white border border-b-white border-gray-200 text-indigo-600 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Pending Approvals
            {pendingUsers.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                {pendingUsers.length > 9 ? '9+' : pendingUsers.length}
              </span>
            )}
          </button>
          <button
            onClick={() => { setActiveTab('reset-requests'); loadResetRequests(); }}
            className={`relative px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'reset-requests'
                ? 'bg-white border border-b-white border-gray-200 text-indigo-600 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Password Resets
            {resetRequests.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-amber-500 rounded-full">
                {resetRequests.length > 9 ? '9+' : resetRequests.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── All Users Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Name', 'Username', 'Email', 'Phone', 'Role', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => (
                  <tr key={u.id} className={`hover:bg-gray-50 transition-colors ${!u.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                          <span className="text-xs font-bold text-indigo-600">
                            {u.full_name?.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{u.full_name}</p>
                          {u.id === currentUser?.id && (
                            <span className="text-xs text-indigo-500 font-medium">You</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.username}</td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3 text-gray-600">{u.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}>
                        {u.role === 'CA' ? <Shield className="w-3 h-3" /> : u.role === 'SUPERADMIN' ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {u.is_active ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {/* Edit */}
                        <button
                          onClick={() => openEdit(u)}
                          title="Edit user"
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {/* Reset password */}
                        <button
                          onClick={() => { setResetModal(u); setResetForm({ newPassword: '', confirm: '' }); }}
                          title="Reset password"
                          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        {/* Toggle active — cannot deactivate self */}
                        {u.id !== currentUser?.id && (
                          <button
                            onClick={() => toggleActive(u)}
                            title={u.is_active ? 'Deactivate' : 'Activate'}
                            className={`p-1.5 rounded-lg transition-colors ${u.is_active ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                          >
                            {u.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Pending Approvals Tab ─────────────────────────────────────────── */}
      {activeTab === 'pending' && isSuperAdmin && (
        pendingLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : pendingUsers.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-700 mb-1">All caught up!</h3>
            <p className="text-sm text-gray-500">No pending registration requests at this time.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 mb-4">
              {pendingUsers.length} user{pendingUsers.length !== 1 ? 's' : ''} waiting for approval
            </p>
            {pendingUsers.map(u => (
              <div
                key={u.id}
                className="bg-white border border-yellow-200 rounded-xl p-5 shadow-sm flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-11 h-11 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-yellow-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{u.full_name}</p>
                    <p className="text-sm text-gray-500 truncate">@{u.username} · {u.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                      {u.phone && <span className="text-xs text-gray-400">{u.phone}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => approveUser(u)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve
                  </button>
                  <button
                    onClick={() => rejectUser(u)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 border border-red-200 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Password Reset Requests Tab ──────────────────────────────────── */}
      {activeTab === 'reset-requests' && isSuperAdmin && (
        resetLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : resetRequests.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-700 mb-1">No pending reset requests</h3>
            <p className="text-sm text-gray-500">All password reset requests have been actioned.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500">
                {resetRequests.length} pending password reset request{resetRequests.length !== 1 ? 's' : ''}
              </p>
              <button
                onClick={loadResetRequests}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-indigo-600 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
            {resetRequests.map(r => {
              const expiresAt = new Date(r.expires_at);
              const minutesLeft = Math.floor((expiresAt - new Date()) / 60_000);
              const isUrgent = minutesLeft < 60;
              return (
                <div
                  key={r.id}
                  className={`bg-white border rounded-xl p-5 shadow-sm flex items-center justify-between gap-4 ${isUrgent ? 'border-orange-200' : 'border-amber-200'}`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${isUrgent ? 'bg-orange-100' : 'bg-amber-100'}`}>
                      <KeyRound className={`w-5 h-5 ${isUrgent ? 'text-orange-600' : 'text-amber-600'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{r.full_name}</p>
                      <p className="text-sm text-gray-500 truncate">@{r.username} · {ROLE_LABELS[r.role] || r.role}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3 text-gray-400" />
                        <span className={`text-xs ${isUrgent ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
                          {minutesLeft > 60
                            ? `Expires in ${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m`
                            : minutesLeft > 0
                              ? `Expires in ${minutesLeft}m — act soon!`
                              : 'Expiring very soon'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => approveResetRequest(r)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Approve
                    </button>
                    <button
                      onClick={() => rejectResetRequest(r)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 border border-red-200 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── Edit Modal ── */}
      {editModal && (
        <Modal title={`Edit — ${editModal.full_name}`} onClose={() => setEditModal(null)}>
          <Field label="Full Name">
            <Input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} />
          </Field>
          <Field label="Email">
            <Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Role">
            <Select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
              <option value="EMPLOYEE">Employee</option>
              <option value="CA">CA</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-3 mt-2">
            <button onClick={() => setEditModal(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Reset Password Modal ── */}
      {resetModal && (
        <Modal title={`Reset Password — ${resetModal.full_name}`} onClose={() => setResetModal(null)}>
          <Field label="New Password">
            <Input type="password" placeholder="Min 6 characters" value={resetForm.newPassword}
              onChange={e => setResetForm(f => ({ ...f, newPassword: e.target.value }))} />
          </Field>
          <Field label="Confirm Password">
            <Input type="password" placeholder="Repeat password" value={resetForm.confirm}
              onChange={e => setResetForm(f => ({ ...f, confirm: e.target.value }))} />
          </Field>
          <div className="flex justify-end gap-3 mt-2">
            <button onClick={() => setResetModal(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={saveReset} disabled={saving} className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
              {saving ? 'Resetting…' : 'Reset Password'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Create User Modal ── */}
      {createModal && (
        <Modal title="Add New User" onClose={() => setCreateModal(false)}>
          <Field label="Full Name">
            <Input placeholder="e.g. Ravi Sharma" value={createForm.full_name}
              onChange={e => setCreateForm(f => ({ ...f, full_name: e.target.value }))} />
          </Field>
          <Field label="Username">
            <Input placeholder="e.g. ravi.sharma" value={createForm.username}
              onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))} />
          </Field>
          <Field label="Email">
            <Input type="email" placeholder="e.g. ravi@firm.com" value={createForm.email}
              onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <Input placeholder="e.g. 9876543210" value={createForm.phone}
              onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Role">
            <Select value={createForm.role} onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}>
              <option value="EMPLOYEE">Employee</option>
              <option value="CA">CA</option>
            </Select>
          </Field>
          <Field label="Password">
            <Input type="password" placeholder="Min 6 characters" value={createForm.password}
              onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} />
          </Field>
          <div className="flex justify-end gap-3 mt-2">
            <button onClick={() => setCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={saveCreate} disabled={saving} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
