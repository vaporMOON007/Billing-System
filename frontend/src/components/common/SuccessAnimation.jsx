import React, { useState, useEffect } from 'react';
import { CheckCircle, Lock, DollarSign, Trash2, Save } from 'lucide-react';

export const SuccessCheckmark = ({ onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 1000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="success-checkmark-container">
        <CheckCircle className="w-20 h-20 text-green-500 animate-success-pop" />
      </div>
    </div>
  );
};

export const FinalizeAnimation = ({ onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 1200);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center">
        <Lock className="w-20 h-20 text-orange-500 animate-lock-rotate" />
        <p className="mt-4 text-lg font-semibold text-orange-600 animate-fade-in">
          Bill Finalized!
        </p>
      </div>
    </div>
  );
};

export const PaymentAnimation = ({ amount, onComplete }) => {
  const [showAmount, setShowAmount] = useState(false);

  useEffect(() => {
    setTimeout(() => setShowAmount(true), 300);
    const timer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 1500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center">
        <DollarSign className="w-20 h-20 text-green-500 animate-coin-bounce" />
        {showAmount && (
          <p className="mt-4 text-xl font-bold text-green-600 animate-fade-in">
            {amount} Received!
          </p>
        )}
      </div>
    </div>
  );
};

export const DeleteAnimation = ({ onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 800);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <Trash2 className="w-20 h-20 text-red-500 animate-delete-fade" />
    </div>
  );
};

export const SaveAnimation = ({ onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 600);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="inline-block">
      <Save className="w-5 h-5 text-green-500 animate-save-pulse" />
    </div>
  );
};

// Confetti component
export const Confetti = () => {
  const particles = Array.from({ length: 50 });
  
  return (
    <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
      {particles.map((_, i) => (
        <div
          key={i}
          className="confetti-particle"
          style={{
            left: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 3}s`,
            backgroundColor: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7'][
              Math.floor(Math.random() * 5)
            ],
          }}
        />
      ))}
    </div>
  );
};

export default SuccessCheckmark;