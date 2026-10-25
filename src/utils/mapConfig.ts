// src/utils/mapConfig.ts
// ONE place for the Google Maps look. Every <MapView> spreads MAP_PROPS:
//
//   <MapView {...MAP_PROPS} style={...}>
//
// The style (colours, labels, light/dark) is edited in Google Cloud Console ->
// Google Maps Platform -> Map Styles. Changes show up without a new build.

import { PROVIDER_GOOGLE } from 'react-native-maps';

/**
 * Map ID generated from Google Cloud Console -> Map Management.
 * NOTE: This only works on Android due to a limitation in react-native-maps.
 * iOS will fall back to the default Google Maps style.
 * (.trim() so a stray space can never invalidate the ID.)
 */
export const GOOGLE_MAP_ID = '1acb3468b6e22d9d32cff791'.trim();

/** Spread onto every <MapView>: Google provider + the app's Map ID. */
export const MAP_PROPS = {
  provider: PROVIDER_GOOGLE,
  googleMapId: GOOGLE_MAP_ID,
} as const;

/** App brand colours used on maps. */
export const BRAND_ORANGE = '#FF751F';
export const DROPOFF_BLACK = '#111827';