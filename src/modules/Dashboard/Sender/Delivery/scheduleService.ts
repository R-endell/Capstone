import { Alert } from 'react-native';
import { supabase } from '../../../../utils/supabase';
import { ScheduleState } from './ScheduleContext';

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
  const cargoPic = state.items.length > 0 ? state.items[0].photoUri : null;

  const { data: cargo } = await supabase
    .from('cargo_profiles')
    .insert({
      description: state.items.map(i => i.description).join(', '),
      cargo_pic: cargoPic,
      total_weight_kg: totalWeight,
      small_box_qty: smallQty,
      medium_box_qty: mediumQty,
      large_box_qty: largeQty,
      is_fragile: isFragile,
      sender_id: dbUserId,
    })
    .select()
    .single();

  // Get rate
  const { data: rate } = await supabase
    .from('delivery_rates')
    .select('rate_id')
    .limit(1)
    .single();

  // Status depends on mode
  const deliveryStatus = mode === 'sendNow' ? 'Accepted' : 'Pending';

  const { data: request } = await supabase
    .from('delivery_requests')
    .insert({
      pickup_type: state.dropoffType,
      scheduled_time: state.scheduledDate
      ? `${state.scheduledDate.getFullYear()}-${String(state.scheduledDate.getMonth() + 1).padStart(2,
     '0')}-${String(state.scheduledDate.getDate()).padStart(2, '0')} 00:00:00`
      : null,
      delivery_status: deliveryStatus,
      receiver_phone: '09171234567', // placeholder
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
const cargoPic = state.items.length > 0 ? state.items[0].photoUri : null;

await supabase
  .from('cargo_profiles')
  .update({
    description: state.items.map(i => i.description).join(', '),
    total_weight_kg: totalWeight,
    small_box_qty: smallQty,
    medium_box_qty: mediumQty,
    large_box_qty: largeQty,
    is_fragile: isFragile,
    cargo_pic: cargoPic,   // <-- NEW: save photo
  })
  .eq('cargo_id', existingIds.cargoId);
  // Update request
  await supabase
  .from('delivery_requests')
  .update({
    pickup_type: state.dropoffType,
    scheduled_time: state.scheduledDate
      ? `${state.scheduledDate.getFullYear()}-${String(state.scheduledDate.getMonth() + 1).padStart(2, '0')}-${String(state.scheduledDate.getDate()).padStart(2, '0')} 00:00:00`
      : null,
    estimated_cost: state.estimatedCost,
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