// App.tsx
import React, { useEffect, useRef, useState } from 'react';
import { AppState, LogBox, Platform, View } from 'react-native';
import {
  NavigationContainer,
  useNavigation,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from './src/utils/supabase';
import { isApprovedProvider, clearLastMode } from './src/utils/resolveHomeRoute';

/* ------------------------------------------------------------------ */
/* Silence noisy library warnings                                     */
/* ------------------------------------------------------------------ */
LogBox.ignoreLogs(['DateTimePicker: `onChange` is deprecated']);
const __origConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
  const first = args[0];
  if (
    typeof first === 'string' &&
    first.includes('DateTimePicker: `onChange` is deprecated')
  ) {
    return;
  }
  __origConsoleWarn(...args);
};

import LoadingScreen from './src/modules/Authentication/LoadingScreen';
import LoginScreen from './src/modules/Authentication/LoginScreen';
import RegisterScreen from './src/modules/Authentication/RegisterScreen';
import PermissionsPromptScreen from './src/modules/Authentication/PermissionsPromptScreen';
import IdentityVerificationScreen from './src/modules/Settings/IdentityVerificationScreen';
import TwoFactorAuthScreen from './src/modules/Settings/TwoFactorAuthScreen';

// Sender Screens
import HomeScreen from './src/modules/Dashboard/Sender/HomeScreen';
import AccountScreen from './src/modules/Dashboard/Sender/AccountScreen';
import ExploreScreen from './src/modules/Dashboard/Sender/ExploreScreen';
import MessagesScreen from './src/modules/Dashboard/Sender/MessagesScreen';
import ActivityScreen from './src/modules/Dashboard/Sender/ActivityScreen';
import EditProfileScreen from './src/modules/Dashboard/Sender/EditProfileScreen';
import RegisterProviderScreen from './src/modules/Dashboard/Sender/RegisterProviderScreen';

// Settings Screens
import SettingsScreen from './src/modules/Settings/SettingsScreen';
import DisputeCenterScreen from './src/modules/Settings/DisputeCenterScreen';
import LegalPoliciesScreen from './src/modules/Settings/LegalPoliciesScreen';
import PolicyDetailScreen from './src/modules/Settings/PolicyDetailScreen';
import SupportScreen from './src/modules/Settings/SupportScreen';

// Dispute Center
import ReportIssueScreen from './src/modules/Dashboard/Disputes/ReportIssueScreen';
import DisputeDetailScreen from './src/modules/Dashboard/Disputes/DisputeDetailScreen';

// Provider Screens
import ProviderAccountScreen from './src/modules/Dashboard/Provider/AccountScreen';
import JobsScreen from './src/modules/Dashboard/Provider/JobsScreen';
import EarningsScreen from './src/modules/Dashboard/Provider/EarningsScreen';
import TaskScreen from './src/modules/Dashboard/Provider/TaskScreen';
import ProviderMessagesScreen from './src/modules/Dashboard/Provider/MessagesScreen';
import ManageVehicleScreen from './src/modules/Dashboard/Provider/Manage/ManageVehicleScreen';
import ManageRoutesScreen from './src/modules/Dashboard/Provider/Manage/ManageRoutesScreen';

// Delivery Features
import { ScheduleProvider } from './src/modules/Dashboard/Sender/Delivery/ScheduleContext';
import DropoffTypeScreen from './src/modules/Dashboard/Sender/Delivery/DropoffTypeScreen';
import ShipmentSizeScreen from './src/modules/Dashboard/Sender/Delivery/ShipmentSizeScreen';
import AddItemScreen from './src/modules/Dashboard/Sender/Delivery/AddItemScreen';
import ScheduleCalendarScreen from './src/modules/Dashboard/Sender/Delivery/ScheduleCalendarScreen';
import LocationSelectScreen from './src/modules/Dashboard/Sender/Delivery/LocationSelectScreen';
import BookingScreen from './src/modules/Dashboard/Sender/Delivery/BookingScreen';
import DeliveryListScreen from './src/modules/Dashboard/Sender/Delivery/DeliveryListScreen';
import ReceiverPickerScreen from './src/modules/Dashboard/Sender/Delivery/ReceiverPickerScreen';

// Notifications Section
import NotificationsList from './src/modules/Dashboard/Disputes/NotificationsList';

// Canonical background matcher
import {
  startBackgroundMatcher,
  stopBackgroundMatcher,
} from './src/services/backgroundMatcher';
import { setActiveRouteId } from './src/services/activeRouteStore';

import PaymentMethodsScreen from './src/modules/Settings/PaymentMethodsScreen';
import AddPaymentMethodScreen from './src/modules/Settings/AddPaymentMethodScreen';

import DeliveryPaymentScreen from './src/modules/Dashboard/Sender/Delivery/DeliveryPaymentScreen';

import { UserProvider } from './src/utils/userContext';
import { ThemeProvider, useTheme } from './src/utils/themeContext';

import LiveTrackingScreen from './src/modules/Dashboard/Sender/Delivery/LiveTrackingScreen';

import './src/services/backgroundLocationTask';

import * as Notifications from 'expo-notifications';
import { registerPushToken } from './src/services/pushService';

export type RootStackParamList = {
  Loading: undefined;
  Login: undefined;
  Register: undefined;
  PermissionsPrompt: undefined;
  IdentityVerification: undefined;
  TwoFactorAuth: undefined;
  MainTabs: { screen?: keyof MainTabParamList; params?: any };
  ProviderTabs: { screen?: keyof ProviderTabParamList; params?: any };
  Account: undefined;
  EditProfile: undefined;
  Settings: undefined;
  DisputeCenter: { mode?: 'provider' } | undefined;
  Support: { role?: 'sender' | 'provider' } | undefined;
  ReportIssue: { requestId?: number } | undefined;
  DisputeDetail: { disputeId: number };
  LegalPolicies: undefined;
  PolicyDetail: { policyId: string };
  RegisterProvider: undefined;
  DropoffType: { mode: 'sendNow' | 'schedule'; editData?: any };
  ShipmentSize: undefined;
  AddItem: { size: 'Small' | 'Medium' | 'Large' };
  ScheduleCalendar: undefined;
  PickupLocation: { type: 'pickup'; initialCoords?: any };
  DropoffLocation: { type: 'dropoff'; initialCoords?: any };
  Booking: { mode: 'sendNow' | 'schedule'; pickedReceiver?: any };
  DeliveryList: { status: 'Pending' | 'Accepted' };
  ManageVehicle: undefined;
  ManageRoutes: undefined;
  ReceiverPicker: { selectedReceiverId?: number | null };
  PaymentMethods: undefined;
  AddPaymentMethod: undefined;
  DeliveryPayment: { requestId: number; amount: number };
  LiveTracking: { deliveryId: number };
  NotificationsList: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Activity: undefined;
  Explore: undefined;
  Messages: undefined;
  Account: undefined;
};

export type ProviderTabParamList = {
  Task: undefined;
  Earnings: undefined;
  Jobs: undefined;
  Messages: undefined;
  Account: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const ProviderTab = createBottomTabNavigator<ProviderTabParamList>();

// --- GLOBAL UNREAD BADGE HOOK ---
function useUnreadMessages() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let isMounted = true;
    let channel: any;

    const fetchUnread = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) return;

        const { data: userRecord } = await supabase
          .from('users')
          .select('user_id')
          .eq('auth_id', user.id)
          .single();

        if (!userRecord) return;

        const userId = userRecord.user_id;

        const { data: providerDelivs } = await supabase
          .from('deliveries')
          .select('delivery_id')
          .eq('provider_id', userId);

        const { data: senderReqs } = await supabase
          .from('delivery_requests')
          .select('request_id')
          .eq('sender_id', userId);

        const reqIds = (senderReqs || []).map((r) => r.request_id);

        let senderDelivs: any[] = [];

        if (reqIds.length > 0) {
          const { data } = await supabase
            .from('deliveries')
            .select('delivery_id')
            .in('request_id', reqIds);

          senderDelivs = data || [];
        }

        const deliveryIds = Array.from(
          new Set([
            ...(providerDelivs || []).map((d) => d.delivery_id),
            ...(senderDelivs || []).map((d) => d.delivery_id),
          ])
        );

        if (deliveryIds.length === 0) {
          if (isMounted) setUnreadCount(0);
          return;
        }

        const { data: rooms } = await supabase
          .from('chat_rooms')
          .select('room_id')
          .in('delivery_id', deliveryIds);

        const roomIds = (rooms || []).map((r) => r.room_id);

        if (roomIds.length === 0) {
          if (isMounted) setUnreadCount(0);
          return;
        }

        const { count } = await supabase
          .from('chat_messages')
          .select('*', { count: 'exact', head: true })
          .in('room_id', roomIds)
          .eq('is_read', false)
          .neq('sender_id', userId);

        if (isMounted) setUnreadCount(count || 0);
      } catch (e) {
        console.log(e);
      }
    };

    fetchUnread();

    channel = supabase
      .channel(`global-unread-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
        },
        () => fetchUnread()
      )
      .subscribe();

    return () => {
      isMounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return unreadCount;
}

// Keeps the Android system navigation bar (Back / Home buttons) in step with the
// app theme. It uses the same colour as the tab bar so the two read as one strip.
// Loaded lazily so the app still runs on a build made before expo-navigation-bar.
function NavigationBarSync() {
  const { colors, isDark } = useTheme();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    try {
      const NavigationBar = require('expo-navigation-bar');
      // Ignored (harmlessly) on edge-to-edge builds, where the tab bar paints this area.
      NavigationBar.setBackgroundColorAsync?.(colors.card).catch?.(() => {});
      NavigationBar.setButtonStyleAsync?.(isDark ? 'light' : 'dark').catch?.(() => {});
      NavigationBar.setBorderColorAsync?.(colors.border).catch?.(() => {});
    } catch {}
  }, [colors.card, colors.border, isDark]);
  return null;
}

// Tab bar that adapts to the device: with 3-button navigation (or a gesture bar)
// the system inset is added below the tabs; with no inset it stays the same size.
function useTabBarStyle() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const bottom = insets.bottom;
  return {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    height: 60 + bottom,
    paddingBottom: 8 + bottom,
    paddingTop: 2,
  } as const;
}

// ---------- Sender Tab Navigator ----------
function MainTabs() {
  const unreadCount = useUnreadMessages();
  const tabBarStyle = useTabBarStyle();
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: any;
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Activity') iconName = focused ? 'time' : 'time-outline';
          else if (route.name === 'Explore') iconName = focused ? 'compass' : 'compass-outline';
          else if (route.name === 'Messages') iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          else if (route.name === 'Account') iconName = focused ? 'person' : 'person-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#F27024',
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Explore" component={ExploreScreen} />
      <Tab.Screen 
        name="Messages" 
        component={MessagesScreen} 
        options={{ tabBarBadge: unreadCount > 0 ? unreadCount : undefined, tabBarBadgeStyle: { backgroundColor: '#EF4444' } }}
      />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}

// Role guard: the Provider interface only renders for an approved provider.
// Anyone else (e.g. a Sender who reached it through stale state or Back
// navigation) is sent to the Sender interface. While the check runs we render
// nothing, so the Provider UI never flashes for the wrong user.
function ProviderTabs() {
  const navigation = useNavigation<any>();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        if (!cancelled) navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        return;
      }
      const ok = await isApprovedProvider(session.user.id);
      if (cancelled) return;
      if (ok === false) {
        await clearLastMode();
        navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
        return;
      }
      setAllowed(true); // true, or unknown (offline) -> don't lock out a real provider
    })();
    return () => { cancelled = true; };
  }, [navigation]);

  if (!allowed) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;
  return <ProviderTabsInner />;
}

// ---------- Provider Tab Navigator ----------
function ProviderTabsInner() {
  const unreadCount = useUnreadMessages();
  const tabBarStyle = useTabBarStyle();
  const { colors } = useTheme();

  return (
    <ProviderTab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: any;

          if (route.name === 'Task') {
            iconName = focused ? 'clipboard' : 'clipboard-outline';
          } else if (route.name === 'Earnings') {
            iconName = focused ? 'bar-chart' : 'bar-chart-outline';
          } else if (route.name === 'Jobs') {
            iconName = focused ? 'map' : 'map-outline';
          } else if (route.name === 'Messages') {
            iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          } else if (route.name === 'Account') {
            iconName = focused ? 'person' : 'person-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#F27024',
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
        headerShown: false,
      })}
    >
      <ProviderTab.Screen name="Task" component={TaskScreen} />
      <ProviderTab.Screen name="Earnings" component={EarningsScreen} />
      <ProviderTab.Screen name="Jobs" component={JobsScreen} />
      <ProviderTab.Screen
        name="Messages"
        component={ProviderMessagesScreen}
        options={{
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: { backgroundColor: '#EF4444' },
        }}
      />
      <ProviderTab.Screen name="Account" component={ProviderAccountScreen} />
    </ProviderTab.Navigator>
  );
}

// ---------- ROLE GUARD ----------
/**
 * Listens to navigation state changes and ensures the current user is
 * actually allowed to be on ProviderTabs. If not, force-navigates back
 * to MainTabs. This is the safety net that prevents the "stuck on provider"
 * bug when the app is killed mid-registration.
 */
function useRoleGuard(navigationRef: React.RefObject<any>) {
  const validatingRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);

  const validateCurrentRoute = async () => {
    if (!navigationRef.current?.isReady?.()) return;
    if (validatingRef.current) return;

    const state = navigationRef.current.getRootState?.();
    if (!state) return;

    // Find the deepest active route name
    const findActiveRoute = (navState: any): string | null => {
      if (!navState) return null;
      const idx = navState.index ?? 0;
      const route = navState.routes?.[idx];
      if (!route) return null;
      if (route.state) return findActiveRoute(route.state);
      return route.name ?? null;
    };

    const activeRoute = findActiveRoute(state);
    if (!activeRoute) return;

    // Only validate when user is on provider screens
    if (activeRoute !== 'ProviderTabs') return;

    validatingRef.current = true;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        navigationRef.current?.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        });
        return;
      }

      const { data: userRow } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', session.user.id)
        .maybeSingle();

      if (!userRow?.user_id) {
        navigationRef.current?.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
        return;
      }

      // Check both role + verification status
      const { data: providerRole } = await supabase
        .from('roles')
        .select('role_id')
        .eq('role_name', 'Provider')
        .maybeSingle();

      const { data: userRole } = providerRole?.role_id
        ? await supabase
            .from('user_roles')
            .select('user_id')
            .eq('user_id', userRow.user_id)
            .eq('role_id', providerRole.role_id)
            .maybeSingle()
        : { data: null };

      const { data: verif } = await supabase
        .from('provider_verifications')
        .select('verification_status')
        .eq('provider_id', userRow.user_id)
        .maybeSingle();

      const isApprovedProvider =
        !!userRole && verif?.verification_status === 'Approved';

      if (!isApprovedProvider) {
        console.warn(
          'ΓÜá∩╕Å Role guard: user is on ProviderTabs but is not an approved provider. Redirecting to MainTabs.',
        );
        navigationRef.current?.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      }
    } catch (err) {
      console.warn('Role guard error:', err);
    } finally {
      validatingRef.current = false;
    }
  };

  // Validate on route change
  useEffect(() => {
    const unsub = navigationRef.current?.addListener?.('state', () => {
      validateCurrentRoute();
    });
    return () => {
      unsub?.();
    };
  }, [navigationRef.current]);

  // Validate when app comes back from background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const wasBackground =
        appStateRef.current.match(/inactive|background/);
      if (wasBackground && next === 'active') {
        validateCurrentRoute();
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, []);
}

// ---------- Inner App ----------
function AppInner() {
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const appStateRef = useRef(AppState.currentState);
  const matcherStartedRef = useRef(false);

  // Attach the role guard
  useRoleGuard(navigationRef as any);

  useEffect(() => {
    let cancelled = false;

    const bootMatcher = async () => {
      if (cancelled) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        if (matcherStartedRef.current) {
          stopBackgroundMatcher();
          matcherStartedRef.current = false;
        }
        return;
      }

      const { data: userRow } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', session.user.id)
        .maybeSingle();

      if (!userRow?.user_id) return;

      // Only start matcher if user is an APPROVED provider
      const { data: providerRole } = await supabase
        .from('roles')
        .select('role_id')
        .eq('role_name', 'Provider')
        .maybeSingle();

      const { data: userRole } = providerRole?.role_id
        ? await supabase
            .from('user_roles')
            .select('user_id')
            .eq('user_id', userRow.user_id)
            .eq('role_id', providerRole.role_id)
            .maybeSingle()
        : { data: null };

      const { data: verif } = await supabase
        .from('provider_verifications')
        .select('verification_status')
        .eq('provider_id', userRow.user_id)
        .maybeSingle();

      if (!userRole || verif?.verification_status !== 'Approved') {
        if (matcherStartedRef.current) {
          stopBackgroundMatcher();
          matcherStartedRef.current = false;
        }
        return;
      }

      const { data: routeRow } = await supabase
        .from('provider_routes')
        .select('route_id')
        .eq('provider_id', userRow.user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!routeRow?.route_id) return;

      await setActiveRouteId(routeRow.route_id);

      if (!matcherStartedRef.current) {
        try {
          startBackgroundMatcher();
          matcherStartedRef.current = true;
          console.log('Γ£à Background matcher started for route', routeRow.route_id);
        } catch (error) {
          console.error('Γ¥î Failed to start background matcher:', error);
        }
      }
    };

    bootMatcher();

    const { data: authSub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (cancelled) return;

      if (!session?.user) {
        if (matcherStartedRef.current) {
          stopBackgroundMatcher();
          matcherStartedRef.current = false;
        }
        return;
      }

      await bootMatcher();
    });

    const appStateSub = AppState.addEventListener('change', (next) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        next === 'active'
      ) {
        bootMatcher();
      }
      appStateRef.current = next;
    });

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      appStateSub.remove();
      if (matcherStartedRef.current) {
        stopBackgroundMatcher();
        matcherStartedRef.current = false;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let notifSub: any = null;

    const bootstrap = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: userRow } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', session.user.id)
        .maybeSingle();
      if (!userRow?.user_id) return;

      await registerPushToken(userRow.user_id);
    };

    bootstrap();

    notifSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const payload = response.notification.request.content.data as any;

      if (
        payload?.type === 'chat' &&
        payload.roomId &&
        navigationRef.isReady?.()
      ) {
        navigationRef.navigate('MainTabs', {
          screen: 'Messages',
          params: { openRoomId: payload.roomId },
        });
        return;
      }

      if (payload?.deliveryId && navigationRef.isReady?.()) {
        navigationRef.navigate('LiveTracking', {
          deliveryId: Number(payload.deliveryId),
        });
      }
    });

    return () => {
      cancelled = true;
      if (notifSub) notifSub.remove();
    };
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName="Loading"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Loading" component={LoadingScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen
          name="PermissionsPrompt"
          component={PermissionsPromptScreen}
        />
        <Stack.Screen
          name="IdentityVerification"
          component={IdentityVerificationScreen}
        />
        <Stack.Screen
          name="TwoFactorAuth"
          component={TwoFactorAuthScreen}
        />
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="ProviderTabs" component={ProviderTabs} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen
          name="DisputeCenter"
          component={DisputeCenterScreen}
        />
        <Stack.Screen name="Support" component={SupportScreen} />
        <Stack.Screen name="ReportIssue" component={ReportIssueScreen} />
        <Stack.Screen name="DisputeDetail" component={DisputeDetailScreen} />
        <Stack.Screen name="LegalPolicies" component={LegalPoliciesScreen} />
        <Stack.Screen name="PolicyDetail" component={PolicyDetailScreen} />
        <Stack.Screen
          name="RegisterProvider"
          component={RegisterProviderScreen}
        />
        <Stack.Screen name="DropoffType" component={DropoffTypeScreen} />
        <Stack.Screen name="ShipmentSize" component={ShipmentSizeScreen} />
        <Stack.Screen name="AddItem" component={AddItemScreen} />
        <Stack.Screen
          name="ScheduleCalendar"
          component={ScheduleCalendarScreen}
        />
        <Stack.Screen
          name="PickupLocation"
          component={LocationSelectScreen}
        />
        <Stack.Screen
          name="DropoffLocation"
          component={LocationSelectScreen}
        />
        <Stack.Screen name="Booking" component={BookingScreen} />
        <Stack.Screen
          name="DeliveryPayment"
          component={DeliveryPaymentScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="LiveTracking"
          component={LiveTrackingScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen name="DeliveryList" component={DeliveryListScreen} />
        <Stack.Screen
          name="ManageVehicle"
          component={ManageVehicleScreen}
        />
        <Stack.Screen name="ManageRoutes" component={ManageRoutesScreen} />
        <Stack.Screen
          name="ReceiverPicker"
          component={ReceiverPickerScreen}
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
        <Stack.Screen name="AddPaymentMethod" component={AddPaymentMethodScreen} />
        <Stack.Screen name="NotificationsList" component={NotificationsList} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ---------- App ----------
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <NavigationBarSync />
        <ScheduleProvider>
          <UserProvider>
            <AppInner />
          </UserProvider>
        </ScheduleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}