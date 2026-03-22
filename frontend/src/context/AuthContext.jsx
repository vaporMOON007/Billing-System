import { createContext, useState, useContext, useEffect } from 'react';
import { authAPI } from '../services/api';
import toast from 'react-hot-toast';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load user from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const login = async (credentials) => {
    try {
      const response = await authAPI.login(credentials);
      const { token, user } = response.data.data; // ✅ FIX: Added .data

      // Save to localStorage
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));

      // Update state
      setToken(token);
      setUser(user);

      toast.success('Login successful!');
      return { success: true };
    } catch (error) {
      const code = error.response?.data?.code;
      const message = error.response?.data?.message || 'Login failed';
      // Don't show a toast for pending_approval — the Login page shows its own banner
      if (code !== 'PENDING_APPROVAL') {
        toast.error(message);
      }
      return { success: false, message, code };
    }
  };

  const logout = () => {
    // Clear localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    // Clear state
    setToken(null);
    setUser(null);

    toast.success('Logged out successfully');
  };

  const register = async (userData) => {
    try {
      const response = await authAPI.register(userData);

      // If pending_approval is true, registration succeeded but no token was issued
      if (response.data.pending_approval) {
        return { success: true, pending_approval: true, message: response.data.message };
      }

      // Admin-created user — token provided, log them in automatically
      if (response.data.data?.token) {
        const { token, user } = response.data.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        setToken(token);
        setUser(user);
        toast.success('User created successfully!');
        return { success: true };
      }

      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Registration failed';
      toast.error(message);
      return { success: false, message };
    }
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    register,
    isAuthenticated: !!token,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};