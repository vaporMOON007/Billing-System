import { useState, useEffect, useCallback, useRef } from 'react';
import { billAPI } from '../services/api';
import toast from 'react-hot-toast';

/**
 * useEditLock — DB-backed edit lock hook (migration 009)
 *
 * Fix: Replaced manual setInterval inside acquireLock (stale closure bug)
 * with a useEffect-driven heartbeat. useEffect always has fresh state because
 * React re-runs it when dependencies change — no frozen copies of functions.
 *
 * The returned API surface is unchanged:
 *   { lockStatus, acquireLock, releaseLock, checkLockStatus, refreshLock }
 */
const useEditLock = (billId, userId) => {
  const [lockStatus, setLockStatus] = useState({
    isLocked:      false,
    lockedBy:      null,
    lockedByName:  null,
    canEdit:       true,
    expiresAt:     null,
  });

  // Tracks whether THIS user currently holds the lock.
  // Stored in a ref so the useEffect heartbeat can always read the latest value
  // without needing it in the dependency array (avoids restart-on-every-render).
  const holdingLock = useRef(false);

  // ── Release lock ──────────────────────────────────────────────────────────
  // Defined before acquireLock so it's available in the heartbeat useEffect.
  const releaseLock = useCallback(async () => {
    if (!billId || !holdingLock.current) return;

    holdingLock.current = false; // stop heartbeat immediately

    try {
      await billAPI.releaseLock(billId, userId);
    } catch (error) {
      console.error('Failed to release lock:', error);
    }

    setLockStatus({
      isLocked:     false,
      lockedBy:     null,
      lockedByName: null,
      canEdit:      true,
      expiresAt:    null,
    });
  }, [billId, userId]);

  // ── Heartbeat — runs as long as this user holds the lock ─────────────────
  // useEffect re-runs whenever holdingLock.current changes (via state trigger).
  // Because it's a useEffect, it always has access to the latest releaseLock.
  // We use a separate boolean state just to trigger the effect — the actual
  // flag is in holdingLock.current (ref) so reads inside the interval are fresh.
  const [heartbeatActive, setHeartbeatActive] = useState(false);

  useEffect(() => {
    if (!heartbeatActive || !billId) return;

    const interval = setInterval(async () => {
      // Check the ref directly — always fresh, never stale
      if (!holdingLock.current) {
        clearInterval(interval);
        return;
      }

      try {
        await billAPI.refreshLock(billId, userId);
      } catch (error) {
        console.error('Failed to refresh lock — lock may have been lost:', error);
        // Lock lost (409 from server or network error) — stop heartbeat and warn user
        holdingLock.current = false;
        setHeartbeatActive(false);
        setLockStatus(prev => ({ ...prev, canEdit: false }));
        toast.error('Your edit session expired. Please reload the bill to continue editing.');
        // Attempt to clean up on server side (best effort)
        billAPI.releaseLock(billId, userId).catch(() => {});
      }
    }, 10_000); // every 10 seconds

    return () => clearInterval(interval);
  }, [heartbeatActive, billId, userId]);

  // ── Acquire lock ──────────────────────────────────────────────────────────
  const acquireLock = useCallback(async () => {
    if (!billId) return;

    try {
      const response = await billAPI.acquireLock(billId, userId);
      const data = response.data;

      if (data.success) {
        holdingLock.current = true;
        setHeartbeatActive(true); // kicks off the useEffect heartbeat
        setLockStatus({
          isLocked:     true,
          lockedBy:     userId,
          lockedByName: data.userName,
          canEdit:      true,
          expiresAt:    data.expiresAt,
        });
        toast.success('You can now edit this bill');
      } else {
        holdingLock.current = false;
        setHeartbeatActive(false);
        setLockStatus({
          isLocked:     true,
          lockedBy:     data.lockedBy,
          lockedByName: data.lockedByName,
          canEdit:      false,
          expiresAt:    data.expiresAt,
        });
        toast.error(`This bill is being edited by ${data.lockedByName}`);
      }
    } catch (error) {
      console.error('Failed to acquire lock:', error);
      toast.error('Failed to acquire edit lock');
    }
  }, [billId, userId]);

  // ── Refresh lock (exposed for external use if needed) ─────────────────────
  const refreshLock = useCallback(async () => {
    if (!billId || !holdingLock.current) return;
    try {
      await billAPI.refreshLock(billId, userId);
    } catch (error) {
      console.error('Failed to refresh lock:', error);
    }
  }, [billId, userId]);

  // ── Check lock status (poll from outside) ─────────────────────────────────
  const checkLockStatus = useCallback(async () => {
    if (!billId) return;
    try {
      const response = await billAPI.checkLock(billId);
      const data = response.data;
      setLockStatus({
        isLocked:     data.isLocked,
        lockedBy:     data.lockedBy,
        lockedByName: data.lockedByName,
        canEdit:      !data.isLocked || data.lockedBy === userId,
        expiresAt:    data.expiresAt,
      });
    } catch (error) {
      console.error('Failed to check lock status:', error);
    }
  }, [billId, userId]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  // Stops the heartbeat and releases the DB lock when the component unmounts
  // (user navigates away, closes the form, etc.)
  useEffect(() => {
    return () => {
      if (holdingLock.current) {
        holdingLock.current = false;
        setHeartbeatActive(false);
        // Fire-and-forget — component is unmounting, can't await
        billAPI.releaseLock(billId, userId).catch(() => {});
      }
    };
  }, [billId, userId]);

  return {
    lockStatus,
    acquireLock,
    releaseLock,
    checkLockStatus,
    refreshLock,
  };
};

export default useEditLock;
