import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LogIn, Eye, EyeOff, AlertTriangle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';

const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // NEW: Security features
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [loginError, setLoginError] = useState('');

  // NEW: Check localStorage for existing lockout
  useEffect(() => {
    const savedLockout = localStorage.getItem('loginLockedUntil');
    if (savedLockout) {
      const lockoutTime = parseInt(savedLockout);
      if (lockoutTime > Date.now()) {
        setLockedUntil(lockoutTime);
      } else {
        localStorage.removeItem('loginLockedUntil');
      }
    }

    const savedAttempts = localStorage.getItem('failedLoginAttempts');
    if (savedAttempts) {
      setFailedAttempts(parseInt(savedAttempts));
    }
  }, []);

  // NEW: Countdown timer for lockout
  useEffect(() => {
    if (lockedUntil) {
      const timer = setInterval(() => {
        const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
        if (remaining <= 0) {
          setLockedUntil(null);
          setFailedAttempts(0);
          setCountdown(0);
          localStorage.removeItem('loginLockedUntil');
          localStorage.removeItem('failedLoginAttempts');
          clearInterval(timer);
        } else {
          setCountdown(remaining);
        }
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [lockedUntil]);

  // NEW: Caps Lock detection
  const handleKeyDown = (e) => {
    setCapsLockOn(e.getModifierState('CapsLock'));
  };

  const handleChange = (e) => {
    setCredentials({
      ...credentials,
      [e.target.name]: e.target.value,
    });
    // Clear error when user starts typing
    if (loginError) setLoginError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Check if locked
    if (lockedUntil && lockedUntil > Date.now()) {
      toast.error('Too many failed attempts. Please wait.');
      return;
    }

    setLoading(true);

    try {
      await login(credentials);
      // Reset on success
      setFailedAttempts(0);
      localStorage.removeItem('failedLoginAttempts');
      localStorage.removeItem('loginLockedUntil');
      navigate('/services-form');
    } catch (error) {
      console.error('Login error:', error);
      
      // NEW: Enhanced error handling
      const newFailedAttempts = failedAttempts + 1;
      setFailedAttempts(newFailedAttempts);
      localStorage.setItem('failedLoginAttempts', newFailedAttempts.toString());

      if (error.response?.status === 401) {
        setLoginError('Incorrect username or password. Please try again.');
      } else {
        setLoginError(error.response?.data?.message || 'Login failed. Please try again.');
      }

      // Lock after 3 attempts
      if (newFailedAttempts >= 3) {
        const lockoutTime = Date.now() + 60000; // 1 minute
        setLockedUntil(lockoutTime);
        localStorage.setItem('loginLockedUntil', lockoutTime.toString());
        toast.error('Too many failed attempts. Please wait 1 minute.', { duration: 3000 });
      } else {
        toast.error(`Login failed. ${3 - newFailedAttempts} attempts remaining.`, { duration: 3000 });  
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-primary-600 rounded-full flex items-center justify-center">
              <LogIn className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Welcome Back</h1>
          <p className="text-gray-600 mt-2">Sign in to your account</p>
        </div>

        {/* NEW: Login Error Banner */}
        {loginError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">{loginError}</p>
              {failedAttempts > 0 && failedAttempts < 3 && (
                <p className="text-xs text-red-600 mt-1">
                  {3 - failedAttempts} attempt(s) remaining before temporary lockout
                </p>
              )}
            </div>
          </div>
        )}

        {/* NEW: Lockout Warning */}
        {lockedUntil && countdown > 0 && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center space-x-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              <p className="text-sm font-semibold text-yellow-800">Account Temporarily Locked</p>
            </div>
            <p className="text-sm text-yellow-700">
              Too many failed login attempts. Please wait <span className="font-bold">{countdown}</span> second(s)
            </p>
            <div className="mt-2 w-full bg-yellow-200 rounded-full h-2">
              <div 
                className="bg-yellow-600 h-2 rounded-full transition-all duration-1000"
                style={{ width: `${((60 - countdown) / 60) * 100}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              type="text"
              name="username"
              value={credentials.username}
              onChange={handleChange}
              disabled={lockedUntil && countdown > 0}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              placeholder="Enter your username"
            />
          </div>

          {/* Password with Caps Lock Warning */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={credentials.password}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyDown}
                disabled={lockedUntil && countdown > 0}
                required
                className="w-full px-4 py-3 pr-20 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                placeholder="Enter your password"
              />
              
              {/* NEW: Caps Lock Warning Icon */}
              {capsLockOn && (
                <div className="absolute right-12 top-1/2 transform -translate-y-1/2 group">
                  <AlertTriangle className="w-5 h-5 text-yellow-500" />
                  <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block">
                    <div className="bg-gray-900 text-white text-xs rounded py-1 px-2 whitespace-nowrap">
                      Caps Lock is ON
                      <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={lockedUntil && countdown > 0}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 disabled:cursor-not-allowed"
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || (lockedUntil && countdown > 0)}
            className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="flex items-center justify-center">
                <div className="spinner w-5 h-5 border-2 mr-2"></div>
                Signing in...
              </div>
            ) : lockedUntil && countdown > 0 ? (
              `Locked - Wait ${countdown}s`
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Register & Reset Password Links */}
        <div className="mt-6 space-y-3">
          <div className="text-center">
            <Link
              to="/reset-password"
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              Forgot Password?
            </Link>
          </div>
          <div className="text-center">
            <p className="text-sm text-gray-600">
              Don't have an account?{' '}
              <Link
                to="/register"
                className="text-primary-600 hover:text-primary-700 font-medium"
              >
                Register Now
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-600">
          <p>© 2025 Billing System. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default Login;