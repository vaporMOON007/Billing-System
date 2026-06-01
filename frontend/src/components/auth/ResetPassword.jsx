import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Eye, EyeOff, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { passwordResetAPI } from '../../services/api';

// ── Helpers ───────────────────────────────────────────────────────────────────
const formatTimeLeft = (expiresAt) => {
  if (!expiresAt) return '';
  const diff = new Date(expiresAt) - new Date();
  if (diff <= 0) return 'Expired';
  const hours   = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
};

// ── Main component ─────────────────────────────────────────────────────────────
const ResetPassword = () => {
  // Form state
  const [username,    setUsername]    = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPwd,  setConfirmPwd]  = useState('');
  const [showPwd,     setShowPwd]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Request state
  const [loading,        setLoading]        = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [requestStatus,  setRequestStatus]  = useState(null); // null | 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  const [expiresAt,      setExpiresAt]      = useState(null);
  const [submitted,      setSubmitted]      = useState(false);

  // ── Check status when username field blurs ─────────────────────────────────
  const checkStatus = async (usernameVal) => {
    if (!usernameVal || !usernameVal.trim()) return;
    setCheckingStatus(true);
    try {
      const res = await passwordResetAPI.getStatus(usernameVal.trim());
      setRequestStatus(res.data.status);
      setExpiresAt(res.data.expires_at || null);
    } catch {
      // silently ignore — don't expose errors on this public endpoint
    } finally {
      setCheckingStatus(false);
    }
  };

  // Reset status badge when username changes
  const handleUsernameChange = (e) => {
    setUsername(e.target.value);
    setRequestStatus(null);
    setExpiresAt(null);
  };

  // ── Submit request ─────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!username.trim()) {
      return toast.error('Please enter your username');
    }
    if (newPassword.length < 6) {
      return toast.error('New password must be at least 6 characters');
    }
    if (newPassword !== confirmPwd) {
      return toast.error('Passwords do not match');
    }

    setLoading(true);
    try {
      await passwordResetAPI.submitRequest({ username: username.trim(), newPassword });
      setSubmitted(true);
      setRequestStatus('PENDING');
    } catch (error) {
      const code = error.response?.data?.code;
      const message = error.response?.data?.message;
      if (code === 'PENDING_REQUEST_EXISTS') {
        setRequestStatus('PENDING');
        toast.error('You already have a pending request. Please wait for admin approval.');
      } else if (code === 'ACCOUNT_DISABLED') {
        setRequestStatus('DISABLED');
      } else if (code === 'ACCOUNT_PENDING') {
        setRequestStatus('ACCOUNT_PENDING');
      } else {
        toast.error(message || 'Failed to submit request. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Status banner component ────────────────────────────────────────────────
  const StatusBanner = () => {
    if (!requestStatus || requestStatus === 'NONE') return null;

    const configs = {
      DISABLED: {
        icon: <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />,
        bg:   'bg-red-50 border-red-200',
        text: 'text-red-800',
        title: 'Account Disabled',
        message: 'Your account has been disabled. Please contact your administrator to reactivate it. Resetting your password will not restore access.',
      },
      ACCOUNT_PENDING: {
        icon: <Clock className="w-5 h-5 text-yellow-600 flex-shrink-0" />,
        bg:   'bg-yellow-50 border-yellow-200',
        text: 'text-yellow-800',
        title: 'Account Pending Approval',
        message: 'Your account is still awaiting approval from an administrator. You cannot reset your password until your account is activated.',
      },
      PENDING: {
        icon: <Clock className="w-5 h-5 text-yellow-600 flex-shrink-0" />,
        bg:   'bg-yellow-50 border-yellow-200',
        text: 'text-yellow-800',
        title: 'Request Pending',
        message: `Your password reset request is waiting for Super Admin approval. ${expiresAt ? formatTimeLeft(expiresAt) : ''}`,
      },
      APPROVED: {
        icon: <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />,
        bg:   'bg-green-50 border-green-200',
        text: 'text-green-800',
        title: 'Request Approved',
        message: 'Your password has been reset. Please go back to login and sign in with your new password.',
      },
      REJECTED: {
        icon: <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />,
        bg:   'bg-red-50 border-red-200',
        text: 'text-red-800',
        title: 'Request Rejected',
        message: 'Your reset request was rejected by the administrator. You may submit a new request below, or contact your admin directly.',
      },
      EXPIRED: {
        icon: <AlertCircle className="w-5 h-5 text-gray-500 flex-shrink-0" />,
        bg:   'bg-gray-50 border-gray-200',
        text: 'text-gray-700',
        title: 'Request Expired',
        message: 'Your previous request expired without being actioned. You may submit a new request below.',
      },
    };

    const cfg = configs[requestStatus];
    if (!cfg) return null;

    return (
      <div className={`mb-5 p-4 rounded-lg border ${cfg.bg} flex items-start gap-3`}>
        {cfg.icon}
        <div>
          <p className={`text-sm font-semibold ${cfg.text}`}>{cfg.title}</p>
          <p className={`text-sm mt-0.5 ${cfg.text}`}>{cfg.message}</p>
        </div>
      </div>
    );
  };

  // If APPROVED — just show success, no form needed
  const showForm = !['APPROVED', 'PENDING', 'DISABLED', 'ACCOUNT_PENDING'].includes(requestStatus);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 py-12 px-4">
      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-primary-600 rounded-full flex items-center justify-center">
              <KeyRound className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Forgot Password</h1>
          <p className="text-gray-600 mt-2 text-sm">
            Submit a reset request — your Super Admin will approve it.
          </p>
        </div>

        {/* Status banner */}
        <StatusBanner />

        {/* Form — hidden if PENDING or APPROVED */}
        {showForm && (
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Info box */}
            <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
              Enter your username and desired new password. Your request will be sent to the Super Admin for approval.
              Requests expire after 12 hours.
            </div>

            {/* Username */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={handleUsernameChange}
                onBlur={() => checkStatus(username)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="Your username"
              />
              {checkingStatus && (
                <p className="text-xs text-gray-400 mt-1">Checking status…</p>
              )}
            </div>

            {/* New Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-3 pr-11 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="At least 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showPwd ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm New Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)}
                  required
                  className="w-full px-4 py-3 pr-11 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Re-enter new password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {confirmPwd && newPassword !== confirmPwd && (
                <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="spinner w-5 h-5 border-2" />
                  Submitting…
                </div>
              ) : (
                'Submit Reset Request'
              )}
            </button>
          </form>
        )}

        {/* Back to login */}
        <div className="mt-6 text-center">
          <Link
            to="/login"
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            ← Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
