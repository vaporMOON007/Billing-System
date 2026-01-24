import { useState, useEffect, useCallback } from 'react';
import { billAPI } from '../services/api';
import toast from 'react-hot-toast';

const useEditLock = (billId, userId) => {
  const [lockStatus, setLockStatus] = useState({
    isLocked: false,
    lockedBy: null,
    lockedByName: null,
    canEdit: true,
    expiresAt: null,
  });

  const [heartbeatInterval, setHeartbeatInterval] = useState(null);

  // Acquire lock
  const acquireLock = useCallback(async () => {
    if (!billId) return;

    try {
      const response = await billAPI.acquireLock(billId, userId);
      const data = response.data;

      if (data.success) {
        setLockStatus({
          isLocked: true,
          lockedBy: userId,
          lockedByName: data.userName,
          canEdit: true,
          expiresAt: data.expiresAt,
        });

        // Start heartbeat
        const interval = setInterval(() => {
          refreshLock();
        }, 10000); // Every 10 seconds

        setHeartbeatInterval(interval);
        toast.success('You can now edit this bill');
      } else {
        setLockStatus({
          isLocked: true,
          lockedBy: data.lockedBy,
          lockedByName: data.lockedByName,
          canEdit: false,
          expiresAt: data.expiresAt,
        });
        toast.error(`This bill is being edited by ${data.lockedByName}`);
      }
    } catch (error) {
      console.error('Failed to acquire lock:', error);
      toast.error('Failed to acquire edit lock');
    }
  }, [billId, userId]);

  // Refresh lock (heartbeat)
  const refreshLock = useCallback(async () => {
    if (!billId || !lockStatus.canEdit) return;

    try {
      await billAPI.refreshLock(billId, userId);
    } catch (error) {
      console.error('Failed to refresh lock:', error);
      // Lock might have expired
      releaseLock();
      toast.warning('Your edit session expired');
    }
  }, [billId, userId, lockStatus.canEdit]);

  // Release lock
  const releaseLock = useCallback(async () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      setHeartbeatInterval(null);
    }

    if (!billId || !lockStatus.canEdit) return;

    try {
      await billAPI.releaseLock(billId, userId);
      setLockStatus({
        isLocked: false,
        lockedBy: null,
        lockedByName: null,
        canEdit: true,
        expiresAt: null,
      });
    } catch (error) {
      console.error('Failed to release lock:', error);
    }
  }, [billId, userId, lockStatus.canEdit, heartbeatInterval]);

  // Check lock status
  const checkLockStatus = useCallback(async () => {
    if (!billId) return;

    try {
      const response = await billAPI.checkLock(billId);
      const data = response.data;

      setLockStatus({
        isLocked: data.isLocked,
        lockedBy: data.lockedBy,
        lockedByName: data.lockedByName,
        canEdit: !data.isLocked || data.lockedBy === userId,
        expiresAt: data.expiresAt,
      });
    } catch (error) {
      console.error('Failed to check lock status:', error);
    }
  }, [billId, userId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      releaseLock();
    };
  }, [releaseLock]);

  return {
    lockStatus,
    acquireLock,
    releaseLock,
    checkLockStatus,
    refreshLock,
  };
};

export default useEditLock;