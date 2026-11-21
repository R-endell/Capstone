// src/services/autoSmsService.ts
import { PermissionsAndroid, Platform } from 'react-native';
import { supabase } from '../utils/supabase';
import { isAutoSmsAvailable, sendSilentSms } from '../../modules/auto-sms';

export type SmsMilestone =
  | 'accepted'
  | 'pickup_approaching'
  | 'pickup_arrived'
  | 'in_transit'
  | 'dropoff_approaching'
  | 'dropoff_arrived'
  | 'grace_timer';

// In-memory guard to prevent rapid GPS ticks from double-firing the same milestone
const inFlightKeys = new Set<string>();
const sentCache = new Set<string>();

let permRequested = false;

export async function ensureSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const already = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
    if (already) return true;
    if (permRequested) return false;
    permRequested = true;
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS, {
      title: 'Automated Delivery SMS',
      message:
        'Pack-N-Ship sends automatic arrival and status SMS alerts to senders and receivers using your SIM while you drive.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export function normalizePhPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

export async function triggerDeliverySmsMilestone(
  deliveryId: number,
  milestone: SmsMilestone,
  extra?: {
    turnInstruction?: string;
    etaMins?: number | null;
    landmarkName?: string | null;
  },
): Promise<boolean> {
  if (!deliveryId) return false;
  const cacheKey = `${deliveryId}:${milestone}`;
  if (sentCache.has(cacheKey) || inFlightKeys.has(cacheKey)) return false;

  if (Platform.OS !== 'android' || !isAutoSmsAvailable()) {
    console.log('[autoSms] Native AutoSms module not loaded (rebuild Android dev client); skipping:', cacheKey);
    return false;
  }

  inFlightKeys.add(cacheKey);
  try {
    const granted = await ensureSmsPermission();
    if (!granted) {
      console.warn('[autoSms] SEND_SMS permission denied; skipping:', cacheKey);
      return false;
    }

    const { data: del, error } = await supabase
      .from('deliveries')
      .select(`
        delivery_id,
        request_id,
        provider_id,
        meetup_landmark_name,
        sms_milestones_sent,
        vehicle:vehicles(vehicle_type, plate_number),
        request:delivery_requests(
          request_id,
          sender_id,
          receiver_phone,
          pickup_type,
          receiver:receiver_id(receiver_name, receiver_phone),
          pickup_location:locations!delivery_requests_pickup_location_id_fkey(place_name, street_address),
          dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(place_name, street_address)
        )
      `)
      .eq('delivery_id', deliveryId)
      .maybeSingle();

    if (error || !del) return false;

    const alreadySent: Record<string, string> =
      del.sms_milestones_sent && typeof del.sms_milestones_sent === 'object'
        ? { ...(del.sms_milestones_sent as Record<string, string>) }
        : {};

    if (alreadySent[milestone]) {
      sentCache.add(cacheKey);
      return false;
    }

    const req: any = Array.isArray(del.request) ? del.request[0] : del.request;
    const veh: any = Array.isArray(del.vehicle) ? del.vehicle[0] : del.vehicle;
    const rcv: any = Array.isArray(req?.receiver) ? req.receiver[0] : req?.receiver;
    const puLoc: any = Array.isArray(req?.pickup_location) ? req.pickup_location[0] : req?.pickup_location;
    const doLoc: any = Array.isArray(req?.dropoff_location) ? req.dropoff_location[0] : req?.dropoff_location;

    // Fetch sender & driver names/phones
    const userIds = [req?.sender_id, del.provider_id].filter(Boolean);
    const { data: users } = await supabase
      .from('users')
      .select('user_id, first_name, last_name, phone_number')
      .in('user_id', userIds);

    const sender = (users || []).find((u: any) => Number(u.user_id) === Number(req?.sender_id));
    const driver = (users || []).find((u: any) => Number(u.user_id) === Number(del.provider_id));

    const code = `PNS-${String(del.request_id ?? del.delivery_id).padStart(4, '0')}`;
    const driverName = driver ? `${driver.first_name || ''} ${driver.last_name || ''}`.trim() || 'Your driver' : 'Your driver';
    const plate = veh?.plate_number ? ` (${veh.plate_number})` : '';
    const senderName = sender?.first_name || 'Sender';
    const receiverName = rcv?.receiver_name || 'Receiver';
    const landmark = extra?.landmarkName || del.meetup_landmark_name || null;
    const pickupPlace = landmark || puLoc?.place_name || puLoc?.street_address || 'the pickup point';
    const dropoffPlace = doLoc?.place_name || doLoc?.street_address || 'the drop-off point';
    const etaText = extra?.etaMins && extra.etaMins > 0 ? ` (ETA ~${extra.etaMins} min)` : '';

    // Pick recipient phone & message per milestone
    const senderPhone = normalizePhPhone(sender?.phone_number);
    const receiverPhone = normalizePhPhone(req?.receiver_phone || rcv?.receiver_phone);

    let toPhone: string | null = null;
    let body = '';

    switch (milestone) {
      case 'accepted':
        toPhone = senderPhone;
        body = landmark
          ? `Pack-N-Ship #${code}: ${driverName}${plate} accepted your Curb-side delivery. Please meet curbside at ${landmark} along the main route.`
          : `Pack-N-Ship #${code}: ${driverName}${plate} accepted your delivery and will head to ${pickupPlace}.`;
        break;

      case 'pickup_approaching':
        toPhone = senderPhone;
        body = `Pack-N-Ship #${code}: ${driverName}${plate} is approaching ${pickupPlace}${etaText}${
          extra?.turnInstruction ? ` (${extra.turnInstruction})` : ''
        }. Please be ready with your Pickup QR/PIN.`;
        break;

      case 'pickup_arrived':
        toPhone = senderPhone;
        body = `Pack-N-Ship #${code}: ${driverName}${plate} has arrived at ${pickupPlace}. Please meet them now with your package and Pickup QR/PIN.`;
        break;

      case 'in_transit':
        toPhone = receiverPhone;
        body = `Pack-N-Ship #${code}: Hi ${receiverName}, your package from ${senderName} has been picked up by ${driverName}${plate} and is now on the way to ${dropoffPlace}.`;
        break;

      case 'dropoff_approaching':
        toPhone = receiverPhone;
        body = `Pack-N-Ship #${code}: ${driverName}${plate} is nearby and approaching ${dropoffPlace}${etaText}${
          extra?.turnInstruction ? ` (${extra.turnInstruction})` : ''
        }. Please be ready to receive your package.`;
        break;

      case 'dropoff_arrived':
        toPhone = receiverPhone;
        body = `Pack-N-Ship #${code}: ${driverName}${plate} has arrived at ${dropoffPlace}. Please meet the driver now with your 6-digit Delivery OTP.`;
        break;

      case 'grace_timer':
        toPhone = receiverPhone;
        body = `Pack-N-Ship #${code}: ${driverName}${plate} is waiting at ${dropoffPlace}. Please meet them within 10 minutes to claim your package.`;
        break;
    }

    if (!toPhone || !body) return false;

    const ok = await sendSilentSms(toPhone, body);
    if (!ok) return false;

    const nowIso = new Date().toISOString();
    alreadySent[milestone] = nowIso;
    sentCache.add(cacheKey);

    const patch: Record<string, any> = { sms_milestones_sent: alreadySent };
    if (milestone === 'grace_timer' || milestone === 'dropoff_arrived' || milestone === 'in_transit') {
      patch.sms_receiver_at = nowIso;
    }
    await supabase.from('deliveries').update(patch).eq('delivery_id', deliveryId);
    console.log(`[autoSms] Sent ${milestone} SMS for delivery #${deliveryId} to ${toPhone}`);
    return true;
  } catch (e: any) {
    console.warn(`[autoSms] Failed ${cacheKey}:`, e?.message || e);
    return false;
  } finally {
    inFlightKeys.delete(cacheKey);
  }
}