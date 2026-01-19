import { NavLink } from 'react-router-dom';
import { FileText, Printer, Settings, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const Sidebar = () => {
  const { user } = useAuth();
  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['CA'] },
    { path: '/services-form', icon: FileText, label: 'Services Form', roles: ['CA', 'EMPLOYEE'] },
    { path: '/print-bill', icon: Printer, label: 'Print Bill', roles: ['CA', 'EMPLOYEE'] },
    { path: '/masters', icon: Settings, label: 'Masters', roles: ['CA', 'EMPLOYEE'] },
  ];

  // Filter nav items based on user role
  const filteredNavItems = navItems.filter(item => 
    !item.roles || item.roles.includes(user?.role)
  );

  return (
    <aside className="w-64 bg-white border-r border-gray-200 min-h-screen">
      <nav className="p-4 space-y-2">
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
            <item.icon className="w-5 h-5" />
            <span className="font-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;