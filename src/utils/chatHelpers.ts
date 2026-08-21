// src/utils/chatHelpers.ts
import { supabase } from './supabase';

export const createChatRoomForDelivery = async (
  deliveryId: number,
  providerId: number,
  senderId: number
) => {
  try {
    // Check if chat room already exists
    const { data: existingRoom } = await supabase
      .from('chat_rooms')
      .select('room_id')
      .eq('delivery_id', deliveryId)
      .maybeSingle();

    if (existingRoom) {
      return existingRoom.room_id;
    }

    // Create new chat room
    const { data, error } = await supabase
      .from('chat_rooms')
      .insert({
        delivery_id: deliveryId,
        provider_id: providerId,
        sender_id: senderId,
      })
      .select('room_id')
      .single();

    if (error) {
      console.error('Error creating chat room:', error);
      return null;
    }

    return data.room_id;
  } catch (error) {
    console.error('Error creating chat room:', error);
    return null;
  }
};