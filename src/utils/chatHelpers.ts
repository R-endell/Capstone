// src/utils/chatHelpers.ts
import { supabase } from './supabase';

/**
 * Get or create the chat room for a delivery.
 * chat_rooms schema = (room_id, delivery_id). Nothing else.
 */
export const getOrCreateChatRoom = async (
  deliveryId: number,
): Promise<number | null> => {
  try {
    const { data: existing } = await supabase
      .from('chat_rooms')
      .select('room_id')
      .eq('delivery_id', deliveryId)
      .maybeSingle();

    if (existing?.room_id) return existing.room_id;

    const { data, error } = await supabase
      .from('chat_rooms')
      .insert({ delivery_id: deliveryId })
      .select('room_id')
      .single();

    if (error) {
      // Race: another client created it between SELECT and INSERT
      const { data: race } = await supabase
        .from('chat_rooms')
        .select('room_id')
        .eq('delivery_id', deliveryId)
        .maybeSingle();
      if (race?.room_id) return race.room_id;
      console.error('Error creating chat room:', error);
      return null;
    }

    return data.room_id;
  } catch (error) {
    console.error('Error creating chat room:', error);
    return null;
  }
};

/** Backwards-compatible alias. */
export const createChatRoomForDelivery = getOrCreateChatRoom;

/** Look up the room_id for a delivery (or null). */
export const getRoomByDelivery = async (deliveryId: number): Promise<number | null> => {
  const { data } = await supabase
    .from('chat_rooms')
    .select('room_id')
    .eq('delivery_id', deliveryId)
    .maybeSingle();
  return data?.room_id ?? null;
};