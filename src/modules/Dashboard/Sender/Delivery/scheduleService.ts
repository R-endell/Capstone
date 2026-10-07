// src/modules/Dashboard/Sender/Delivery/scheduleService.ts
import { Alert } from 'react-native';
import { supabase } from '../../../../utils/supabase';
import { ScheduleState } from './ScheduleContext';

// Storage bucket for package photos (create it in Supabase -> Storage, mark it Public)
const CARGO_PHOTO_BUCKET = 'cargo-photos';

// expo-file-system moved its classic API to "/legacy" in newer SDKs; support both
let FileSystem: any = null;
try { FileSystem = require('expo-file-system/legacy'); } catch {}
if (!FileSystem?.readAsStringAsync) {
  try { FileSystem = require('expo-file-system'); } catch {}
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

// Uploads a local photo to Supabase Storage and returns its public URL.
// Already-uploaded URLs are returned unchanged; failures return null so booking is not blocked.
async function uploadCargoPhoto(uri: string | null | undefined): Promise<string | null> {
  if (!uri) return null;
  if (/^https?:\/\//i.test(uri)) return uri;
  try {
    if (!FileSystem?.readAsStringAsync) {
      throw new Error('expo-file-system is not installed. Run: npx expo install expo-file-system');
    }
    const { data: { user } } = await supabase.auth.getUser();
    const folder = user?.id || 'anonymous';
    const ext = (uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    // Random suffix: items are uploaded in parallel, so Date.now() alone could collide
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext === 'png' ? 'png' : 'jpg'}`;

    // Read the picked file as base64 and upload the raw bytes (works on Android and iOS)
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const bytes = base64ToBytes(base64);
    if (bytes.length < 500) {
      throw new Error(`The picked image could not be read (${bytes.length} bytes)`);
    }

    const { error } = await supabase.storage
      .from(CARGO_PHOTO_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (error) throw error;

    const publicUrl = supabase.storage.from(CARGO_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

    // Make sure the public link really serves an image; if not (private bucket etc.), save a long-lived signed link
    try {
      const head = await fetch(publicUrl, { method: 'HEAD' });
      const type = head.headers.get('content-type') || '';
      if (head.ok && type.startsWith('image/')) return publicUrl;
    } catch { /* fall through to signed URL */ }

    const { data: signed, error: signErr } = await supabase.storage
      .from(CARGO_PHOTO_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signErr || !signed?.signedUrl) throw signErr || new Error('Could not create a link for the uploaded photo');
    return signed.signedUrl;
  } catch (e: any) {
    console.warn('Cargo photo upload failed:', e?.message || e, e?.statusCode ? `(status ${e.statusCode})` : '');
    return null;
  }
}

// Uploads every item's own photo and returns a per-item payload
async function buildItemsPayload(items: ScheduleState['items']) {
  return Promise.all(
    items.map(async (i: any) => ({
      size: i.size,
      description: i.description,
      fragile: !!i.fragile,
      photo: await uploadCargoPhoto(i.photoUri),
    }))
  );
}

export async function saveScheduleToDB(state: ScheduleState, mode: 'sendNow' | 'schedule') {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  let { data: userRecord } = await supabase
    .from('users')
    .select('user_id')
    .eq('auth_id', user.id)
    .maybeSingle();

  if (!userRecord) {
    const metadata = user.user_metadata || {};
    const { data: newUser, error: createErr } = await supabase
      .from('users')
      .insert({
        auth_id: user.id,
        first_name: metadata.first_name || 'First',
        last_name: metadata.last_name || 'Last',
        email: user.email || '',
        phone_number: metadata.phone_number || '',
        is_verified: false,
        is_active: true,
      })
      .select('user_id')
      .single();
    if (createErr) throw createErr;
    userRecord = newUser;
  }

  const dbUserId = userRecord.user_id;

  // Insert locations
  const { data: pickupLoc } = await supabase
    .from('locations')
    .insert({
      street_address: state.pickupLocation!.address,
      barangay: '', city: '', province: '', zip_code: '',
      latitude: state.pickupLocation!.latitude,
      longitude: state.pickupLocation!.longitude,
    })
    .select()
    .single();

  const { data: dropoffLoc } = await supabase
    .from('locations')
    .insert({
      street_address: state.dropoffLocation!.address,
      barangay: '', city: '', province: '', zip_code: '',
      latitude: state.dropoffLocation!.latitude,
      longitude: state.dropoffLocation!.longitude,
    })
    .select()
    .single();

  // Insert cargo
  const smallQty = state.items.filter(i => i.size === 'Small').length;
  const mediumQty = state.items.filter(i => i.size === 'Medium').length;
  const largeQty = state.items.filter(i => i.size === 'Large').length;
  const isFragile = state.items.some(i => i.fragile);
  const totalWeight = smallQty * 5 + mediumQty * 15 + largeQty * 30;
  const itemsPayload = await buildItemsPayload(state.items);
  const cargoPic = itemsPayload.find(i => i.photo)?.photo ?? null;

  const cargoBase = {
    description: state.items.map(i => i.description).join(', '),
    cargo_pic: cargoPic,
    total_weight_kg: totalWeight,
    small_box_qty: smallQty,
    medium_box_qty: mediumQty,
    large_box_qty: largeQty,
    is_fragile: isFragile,
    sender_id: dbUserId,
  };

  // items_json keeps each item's own photo/description. If the column hasn't been added yet, fall back.
  let { data: cargo, error: cargoErr } = await supabase
    .from('cargo_profiles')
    .insert({ ...cargoBase, items_json: itemsPayload })
    .select()
    .single();
  if (cargoErr) {
    console.warn('items_json save failed, retrying without it:', cargoErr.message);
    const retry = await supabase.from('cargo_profiles').insert(cargoBase).select().single();
    cargo = retry.data;
    if (retry.error) throw retry.error;
  }

  // Get rate
  const { data: rate } = await supabase
    .from('delivery_rates')
    .select('rate_id')
    .limit(1)
    .single();

  // Status depends on mode
  const deliveryStatus = 'Pending';

  /* ============================================================
   * ✅ FIX: Read receiver from state — do NOT hardcode phone.
   *    Prefer receiver_id + receiver_phone from the picked receiver.
   *    Fall back to state.receiver's phone_number if needed.
   * ============================================================ */
  // ScheduleState may not declare `receiver`, so read it loosely to avoid TS errors
  const stateReceiver = (state as any).receiver;
  const receiverId = stateReceiver?.receiver_id ?? null;
  const receiverPhone =
    stateReceiver?.receiver_phone ||
    stateReceiver?.phone_number ||
    '';

  const { data: request } = await supabase
    .from('delivery_requests')
    .insert({
      pickup_type: state.dropoffType,
      scheduled_time: state.scheduledDate
        ? `${state.scheduledDate.getFullYear()}-${String(state.scheduledDate.getMonth() + 1).padStart(2, '0')}-${String(state.scheduledDate.getDate()).padStart(2, '0')} 00:00:00`
        : null,
      delivery_status: deliveryStatus,

      receiver_id: receiverId,
      receiver_phone: receiverPhone,

      total_distance: 5.0,
      estimated_cost: state.estimatedCost,
      dropoff_location_id: dropoffLoc!.location_id,
      pickup_location_id: pickupLoc!.location_id,
      rate_id: rate!.rate_id,
      sender_id: dbUserId,
      cargo_id: cargo!.cargo_id,
    })
    .select()
    .single();

  return request;
}

// Update existing request
export async function updateScheduleInDB(
  state: ScheduleState,
  existingIds: {
    requestId: number;
    cargoId: number;
    pickupLocId: number;
    dropoffLocId: number;
  }
) {
  // Update pickup location
  await supabase
    .from('locations')
    .update({
      street_address: state.pickupLocation!.address,
      latitude: state.pickupLocation!.latitude,
      longitude: state.pickupLocation!.longitude,
    })
    .eq('location_id', existingIds.pickupLocId);

  await supabase
    .from('locations')
    .update({
      street_address: state.dropoffLocation!.address,
      latitude: state.dropoffLocation!.latitude,
      longitude: state.dropoffLocation!.longitude,
    })
    .eq('location_id', existingIds.dropoffLocId);

  // Update cargo
  const smallQty = state.items.filter(i => i.size === 'Small').length;
  const mediumQty = state.items.filter(i => i.size === 'Medium').length;
  const largeQty = state.items.filter(i => i.size === 'Large').length;
  const isFragile = state.items.some(i => i.fragile);
  const totalWeight = smallQty * 5 + mediumQty * 15 + largeQty * 30;

  // Use the first available photo from the items (if any)
  const itemsPayload = await buildItemsPayload(state.items);
  const cargoPic = itemsPayload.find(i => i.photo)?.photo ?? null;

  const cargoUpdate = {
    description: state.items.map(i => i.description).join(', '),
    total_weight_kg: totalWeight,
    small_box_qty: smallQty,
    medium_box_qty: mediumQty,
    large_box_qty: largeQty,
    is_fragile: isFragile,
    cargo_pic: cargoPic,
  };
  const { error: cargoUpdErr } = await supabase
    .from('cargo_profiles')
    .update({ ...cargoUpdate, items_json: itemsPayload })
    .eq('cargo_id', existingIds.cargoId);
  if (cargoUpdErr) {
    console.warn('items_json update failed, retrying without it:', cargoUpdErr.message);
    await supabase.from('cargo_profiles').update(cargoUpdate).eq('cargo_id', existingIds.cargoId);
  }

  /* ============================================================
   * ✅ FIX: Keep receiver in sync on edit.
   * ============================================================ */
  // ScheduleState may not declare `receiver`, so read it loosely to avoid TS errors
  const stateReceiver = (state as any).receiver;
  const receiverId = stateReceiver?.receiver_id ?? null;
  const receiverPhone =
    stateReceiver?.receiver_phone ||
    stateReceiver?.phone_number ||
    '';

  // Update request
  await supabase
    .from('delivery_requests')
    .update({
      pickup_type: state.dropoffType,
      scheduled_time: state.scheduledDate
        ? `${state.scheduledDate.getFullYear()}-${String(state.scheduledDate.getMonth() + 1).padStart(2, '0')}-${String(state.scheduledDate.getDate()).padStart(2, '0')} 00:00:00`
        : null,
      estimated_cost: state.estimatedCost,

      receiver_id: receiverId,
      receiver_phone: receiverPhone,
    })
    .eq('request_id', existingIds.requestId);
}

export async function deleteDelivery(
  requestId: number,
  cargoId: number,
  pickupLocId: number,
  dropoffLocId: number
) {
  // Delete the request first (child tables depend on it)
  const { error: reqErr } = await supabase
    .from('delivery_requests')
    .delete()
    .eq('request_id', requestId);

  if (reqErr) {
    console.error('Delete request error:', reqErr);
    throw reqErr;
  }

  // Now delete the associated records in parallel
  const [cargoRes, pickupRes, dropoffRes] = await Promise.all([
    supabase.from('cargo_profiles').delete().eq('cargo_id', cargoId),
    supabase.from('locations').delete().eq('location_id', pickupLocId),
    supabase.from('locations').delete().eq('location_id', dropoffLocId),
  ]);

  if (cargoRes.error) console.error('Delete cargo error:', cargoRes.error);
  if (pickupRes.error) console.error('Delete pickup location error:', pickupRes.error);
  if (dropoffRes.error) console.error('Delete dropoff location error:', dropoffRes.error);
}