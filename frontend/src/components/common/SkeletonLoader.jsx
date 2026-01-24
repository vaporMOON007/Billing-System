import React from 'react';

// Skeleton base component
const Skeleton = ({ className = '', variant = 'rectangular', width, height, animation = true }) => {
  const baseClass = 'bg-gray-200 rounded';
  const animationClass = animation ? 'animate-pulse' : '';
  
  const variantClasses = {
    rectangular: 'rounded',
    circular: 'rounded-full',
    text: 'rounded h-4',
  };

  const style = {
    width: width || '100%',
    height: height || (variant === 'text' ? '1rem' : '100%'),
  };

  return (
    <div
      className={`${baseClass} ${variantClasses[variant]} ${animationClass} ${className}`}
      style={style}
    />
  );
};

// Table skeleton
export const TableSkeleton = ({ rows = 8, columns = 6 }) => {
  return (
    <div className="w-full">
      {/* Table Header */}
      <div className="grid gap-4 p-4 border-b bg-gray-50" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} height="20px" />
        ))}
      </div>
      
      {/* Table Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid gap-4 p-4 border-b"
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} height="16px" />
          ))}
        </div>
      ))}
    </div>
  );
};

// Card skeleton
export const CardSkeleton = ({ count = 4 }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white p-6 rounded-lg shadow">
          <Skeleton height="24px" width="60%" className="mb-4" />
          <Skeleton height="36px" width="80%" className="mb-2" />
          <Skeleton height="16px" width="40%" />
        </div>
      ))}
    </div>
  );
};

// Form skeleton
export const FormSkeleton = ({ fields = 6 }) => {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i}>
          <Skeleton height="16px" width="120px" className="mb-2" />
          <Skeleton height="40px" width="100%" />
        </div>
      ))}
    </div>
  );
};

// List skeleton
export const ListSkeleton = ({ items = 5 }) => {
  return (
    <div className="space-y-3">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center space-x-3 p-3 border rounded">
          <Skeleton variant="circular" width="40px" height="40px" />
          <div className="flex-1">
            <Skeleton height="16px" width="70%" className="mb-2" />
            <Skeleton height="12px" width="40%" />
          </div>
        </div>
      ))}
    </div>
  );
};

export default Skeleton;