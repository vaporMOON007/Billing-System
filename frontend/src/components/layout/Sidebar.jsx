import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart2, FilePlus, Printer, Settings, Users, ClipboardList } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useEffect, useState } from 'react';
import { userAPI } from '../../services/api';

const Sidebar = () => {
  const { user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  // Poll for pending user approvals if SUPERADMIN, and respond instantly to approve/reject actions
  useEffect(() => {
    if (user?.role !== 'SUPERADMIN') return;

    const fetchPendingCount = () => {
      userAPI.getPendingCount()
        .then(res => setPendingCount(res.data.count || 0))
        .catch(() => {});
    };

    fetchPendingCount();
    const interval = setInterval(fetchPendingCount, 30000); // background refresh every 30s

    // Instantly update when an approval/rejection happens in UserManagementPage
    window.addEventListener('pendingUsersChanged', fetchPendingCount);

    return () => {
      clearInterval(interval);
      window.removeEventListener('pendingUsersChanged', fetchPendingCount);
    };
  }, [user?.role]);

  // Order: Dashboard → Reports → Create Bill → Print Bill → Masters → User Management → Audit Log
  const navItems = [
    { path: '/dashboard',       icon: LayoutDashboard, label: 'Dashboard',       roles: ['SUPERADMIN'] },
    { path: '/reports',         icon: BarChart2,        label: 'Reports',         roles: ['SUPERADMIN'] },
    { path: '/services-form',   icon: FilePlus,         label: 'Create Bill',     roles: ['CA', 'EMPLOYEE', 'SUPERADMIN'] },
    { path: '/print-bill',      icon: Printer,          label: 'Print Bill',      roles: ['CA', 'EMPLOYEE', 'SUPERADMIN'] },
    { path: '/masters',         icon: Settings,         label: 'Masters',         roles: ['CA', 'EMPLOYEE', 'SUPERADMIN'] },
    { path: '/user-management', icon: Users,            label: 'User Management', roles: ['SUPERADMIN'], badge: pendingCount },
    { path: '/audit-log',       icon: ClipboardList,    label: 'Audit Log',       roles: ['CA', 'SUPERADMIN'] },
  ];

  const filteredNavItems = navItems.filter(item =>
    !item.roles || item.roles.includes(user?.role)
  );

  return (
    <aside className="w-64 bg-white border-r border-gray-200 min-h-screen">
      <nav className="p-4 space-y-1">
        {filteredNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`
            }
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium flex-1">{item.label}</span>
            {item.badge > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
                {item.badge > 9 ? '9+' : item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;
