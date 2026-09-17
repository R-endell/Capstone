// App.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, AppState, LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './src/utils/supabase';

/* ------------------------------------------------------------------ */
/* Silence noisy library warnings                                      */
/* ------------------------------------------------------------------ */
LogBox.ignoreLogs(['DateTimePicker: `onChange` is deprecated']);
const __origConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('DateTimePicker: `onChange` is deprecated')) return;
  __origConsoleWarn(...args);
};

import LoadingScreen from './src/modules/Authentication/LoadingScreen';
import LoginScreen from './src/modules/Authentication/LoginScreen';
import RegisterScreen from './src/modules/Authentication/RegisterScreen';
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
import PaymentMethodsScreen from './src/modules/Dashboard/Sender/PaymentMethodsScreen';
import AddPaymentMethodScreen from './src/modules/Dashboard/Sender/AddPaymentMethodScreen';

// Settings Screens
import SettingsScreen from './src/modules/Settings/SettingsScreen';
import DisputeCenterScreen from './src/modules/Settings/DisputeCenterScreen';
import LegalPoliciesScreen from './src/modules/Settings/LegalPoliciesScreen';

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

// Import matching service
import { startBackgroundMatcher } from './src/services/matchingService';

export type RootStackParamList = {
  Loading: undefined;
  Login: undefined;
  Register: undefined;
  IdentityVerification: undefined;
  TwoFactorAuth: undefined;
  MainTabs: { screen?: keyof MainTabParamList };
  ProviderTabs: { screen?: keyof ProviderTabParamList };
  Account: undefined;
  EditProfile: undefined;
  Settings: undefined;
  DisputeCenter: undefined;
  LegalPolicies: undefined;
  RegisterProvider: undefined;
  PaymentMethods: undefined;
  AddPaymentMethod: undefined;
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
};

export type MainTabParamList = { Home: undefined; Explore: undefined; Messages: undefined; Activity: undefined; Account: undefined; };
export type ProviderTabParamList = { Task: undefined; Earnings: undefined; Jobs: undefined; Messages: undefined; Account: undefined; };

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
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: userRecord } = await supabase.from('users').select('user_id').eq('auth_id', user.id).single();
        if (!userRecord) return;
        const userId = userRecord.user_id;

        const { data: providerDelivs } = await supabase.from('deliveries').select('delivery_id').eq('provider_id', userId);
        const { data: senderReqs } = await supabase.from('delivery_requests').select('request_id').eq('sender_id', userId);
        const reqIds = (senderReqs || []).map(r => r.request_id);

        let senderDelivs: any[] = [];
        if (reqIds.length > 0) {
          const { data } = await supabase.from('deliveries').select('delivery_id').in('request_id', reqIds);
          senderDelivs = data || [];
        }

        const deliveryIds = Array.from(new Set([
          ...(providerDelivs || []).map(d => d.delivery_id),
          ...(senderDelivs || []).map(d => d.delivery_id)
        ]));

        if (deliveryIds.length === 0) {
          if (isMounted) setUnreadCount(0);
          return;
        }

        const { data: rooms } = await supabase.from('chat_rooms').select('room_id').in('delivery_id', deliveryIds);
        const roomIds = (rooms || []).map(r => r.room_id);

        if (roomIds.length === 0) {
          if (isMounted) setUnreadCount(0);
          return;
        }

        const { count } = await supabase.from('chat_messages')
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

    channel = supabase.channel(`global-unread-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, () => fetchUnread())
      .subscribe();

    return () => {
      isMounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return unreadCount;
}

// ---------- Sender Tab Navigator ----------
function MainTabs() {
  const unreadCount = useUnreadMessages();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: any;
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Explore') iconName = focused ? 'compass' : 'compass-outline';
          else if (route.name === 'Messages') iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          else if (route.name === 'Activity') iconName = focused ? 'time' : 'time-outline';
          else if (route.name === 'Account') iconName = focused ? 'person' : 'person-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#F27024',
        tabBarInactiveTintColor: '#6B7280',
        tabBarStyle: { backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#E5E7EB', height: 60, paddingBottom: 8, paddingTop: 2 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Explore" component={ExploreScreen} />
      <Tab.Screen 
        name="Messages" 
        component={MessagesScreen} 
        options={{ tabBarBadge: unreadCount > 0 ? unreadCount : undefined, tabBarBadgeStyle: { backgroundColor: '#EF4444' } }}
      />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}

// ---------- Provider Tab Navigator ----------
function ProviderTabs() {
  const unreadCount = useUnreadMessages();

  return (
    <ProviderTab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: any;
          if (route.name === 'Task') iconName = focused ? 'clipboard' : 'clipboard-outline';
          else if (route.name === 'Earnings') iconName = focused ? 'bar-chart' : 'bar-chart-outline';
          else if (route.name === 'Jobs') iconName = focused ? 'map' : 'map-outline';
          else if (route.name === 'Messages') iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          else if (route.name === 'Account') iconName = focused ? 'person' : 'person-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#F27024',
        tabBarInactiveTintColor: '#6B7280',
        tabBarStyle: { backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#E5E7EB', height: 60, paddingBottom: 8, paddingTop: 2 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        headerShown: false,
      })}
    >
      <ProviderTab.Screen name="Task" component={TaskScreen} />
      <ProviderTab.Screen name="Earnings" component={EarningsScreen} />
      <ProviderTab.Screen name="Jobs" component={JobsScreen} />
      <ProviderTab.Screen 
        name="Messages" 
        component={ProviderMessagesScreen} 
        options={{ tabBarBadge: unreadCount > 0 ? unreadCount : undefined, tabBarBadgeStyle: { backgroundColor: '#EF4444' } }}
      />
      <ProviderTab.Screen name="Account" component={ProviderAccountScreen} />
    </ProviderTab.Navigator>
  );
}

// ---------- App ----------
export default function App() {
  const appStateRef = useRef(AppState.currentState);
  const matcherCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    try {
      matcherCleanupRef.current = startBackgroundMatcher();
    } catch (error) {
      console.error('❌ Failed to start background matcher:', error);
    }

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        if (matcherCleanupRef.current) {
          try { matcherCleanupRef.current(); } catch (error) {}
          matcherCleanupRef.current = null;
        }
        try {
          matcherCleanupRef.current = startBackgroundMatcher();
        } catch (error) {}
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      if (matcherCleanupRef.current) {
        try { matcherCleanupRef.current(); } catch (error) {}
        matcherCleanupRef.current = null;
      }
      subscription.remove();
    };
  }, []);

  return (
    <ScheduleProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Loading" screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Loading" component={LoadingScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
          <Stack.Screen name="IdentityVerification" component={IdentityVerificationScreen} />
          <Stack.Screen name="TwoFactorAuth" component={TwoFactorAuthScreen} />
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="ProviderTabs" component={ProviderTabs} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="DisputeCenter" component={DisputeCenterScreen} />
          <Stack.Screen name="LegalPolicies" component={LegalPoliciesScreen} />
          <Stack.Screen name="RegisterProvider" component={RegisterProviderScreen} />
          <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
          <Stack.Screen name="AddPaymentMethod" component={AddPaymentMethodScreen} />
          <Stack.Screen name="DropoffType" component={DropoffTypeScreen} />
          <Stack.Screen name="ShipmentSize" component={ShipmentSizeScreen} />
          <Stack.Screen name="AddItem" component={AddItemScreen} />
          <Stack.Screen name="ScheduleCalendar" component={ScheduleCalendarScreen} />
          <Stack.Screen name="PickupLocation" component={LocationSelectScreen} />
          <Stack.Screen name="DropoffLocation" component={LocationSelectScreen} />
          <Stack.Screen name="Booking" component={BookingScreen} />
          <Stack.Screen name="DeliveryList" component={DeliveryListScreen} />
          <Stack.Screen name="ManageVehicle" component={ManageVehicleScreen} />
          <Stack.Screen name="ManageRoutes" component={ManageRoutesScreen} />
          <Stack.Screen name="ReceiverPicker" component={ReceiverPickerScreen} options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </ScheduleProvider>
  );
}