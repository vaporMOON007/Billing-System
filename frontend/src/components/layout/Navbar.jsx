import { useState, useEffect } from 'react';
import { LogOut, User, KeyRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { passwordResetAPI } from '../../services/api';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isSuperAdmin = user?.role === 'SUPERADMIN';

  const [resetCount, setResetCount] = useState(0);

  // Fetch pending reset request count for SUPERADMIN badge
  const fetchResetCount = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await passwordResetAPI.getPendingCount();
      setResetCount(res.data.count || 0);
    } catch {
      // silently ignore — badge is non-critical
    }
  };

  useEffect(() => {
    fetchResetCount();

    // Poll every 2 minutes to keep badge fresh
    const interval = setInterval(fetchResetCount, 2 * 60 * 1000);

    // Also update when User Management page actions a reset request
    const handler = () => fetchResetCount();
    window.addEventListener('resetRequestsChanged', handler);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resetRequestsChanged', handler);
    };
  }, [isSuperAdmin]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <h1 className="text-2xl font-bold text-primary-600">
              Billing System
            </h1>
          </div>

          {/* Right side */}
          <div className="flex items-center space-x-4">

            {/* Password reset badge — SUPERADMIN only */}
            {isSuperAdmin && resetCount > 0 && (
              <Link
                to="/user-management"
                title={`${resetCount} pending password reset request${resetCount !== 1 ? 's' : ''}`}
                className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-amber-50 hover:bg-amber-100 transition-colors"
              >
                <KeyRound className="w-5 h-5 text-amber-600" />
                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-amber-500 rounded-full">
                  {resetCount > 9 ? '9+' : resetCount}
                </span>
              </Link>
            )}

            {/* User info */}
            <div className="flex items-center space-x-2">
              <User className="w-5 h-5 text-gray-600" />
              <span className="text-sm font-medium text-gray-700">
                {user?.full_name}
              </span>
            </div>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
