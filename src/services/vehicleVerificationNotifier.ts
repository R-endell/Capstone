// src/services/vehicleVerificationNotifier.ts
//
// Push notification when the admin VERIFIES (or rejects) a provider's vehicle.
//
// Client side: every screen that sees a vehicle row (ManageVehicleScreen live + on open, JobsScreen on open) calls
// notifyOnVehicleDecision(). A notification is sent only for a REAL change: the last status stored for that vehicle
// was "Pending" and now it is "Verified" / "Rejected". Opening the app again never repeats it.
//
// Two ways to deliver the push (same idea as providerApplicationNotifier):
//  1) SERVER (recommended, works while the app is closed): run
//     supabase/migrations/20261122_vehicle_verification_push.sql, then set SERVER_PUSH_ENABLED = true below.
//  2) CLIENT fallback (SERVER_PUSH_ENABLED = false): the phone sends the push to itself when it sees the change.
//     Works only while the app is running.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notifyUser } from './pushService';

/** Set to true after the SQL trigger is installed, so the phone does not send a duplicate. */
export const SERVER_PUSH_ENABLED = false;

type VehicleLike = {
  vehicle_id: number;
  vehicle_type?: string | null;
  plate_number?: string | null;
  verification_status?: string | null;
  rejection_reason?: string | null;
};

const storageKey = (vehicleId: number) => `vehicle_verification_status_${vehicleId}`;
const busy = new Set<number>();

export const notifyOnVehicleDecision = async (userId: number, v: VehicleLike) => {
  const vehicleId = Number(v?.vehicle_id);
  const status = String(v?.verification_status || '');
  if (!userId || !vehicleId || !status || busy.has(vehicleId)) return;   // realtime + fetch can report the same change
  busy.add(vehicleId);
  try {
    const prev = await AsyncStorage.getItem(storageKey(vehicleId));
    if (prev === status) return;
    await AsyncStorage.setItem(storageKey(vehicleId), status);

    if (prev !== 'Pending') return;                  // only Pending -> Verified / Rejected is a decision
    if (SERVER_PUSH_ENABLED) return;                 // the database already sent it

    const label = [v.vehicle_type, v.plate_number ? `(${v.plate_number})` : ''].filter(Boolean).join(' ') || 'Your vehicle';
    if (status === 'Verified') {
      await notifyUser(
        userId,
        'Vehicle verified ✅',
        `${label} was verified. You can now post a route and go online.`,
        { type: 'vehicle_verification', status: 'Verified', vehicleId },
      );
    } else if (status === 'Rejected') {
      await notifyUser(
        userId,
        'Vehicle not approved',
        v.rejection_reason?.trim()
          ? `${label}: ${v.rejection_reason.trim()}`
          : `${label} was not approved. Open Manage Vehicle to review and resubmit.`,
        { type: 'vehicle_verification', status: 'Rejected', vehicleId },
      );
    }
  } catch (e) {
    console.warn('[vehicleVerificationNotifier]', e);
  } finally {
    busy.delete(vehicleId);
  }
};