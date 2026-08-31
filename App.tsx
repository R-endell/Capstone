// App.tsx
import React, { useEffect, useRef } from 'react';
import { View, AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

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

// Import matching service
import { startBackgroundMatcher, stopBackgroundMatcher } from './src/services/matchingService';

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
  Booking: { mode: 'sendNow' | 'schedule' };
  DeliveryList: { status: 'Pending' | 'Accepted' };
  ManageVehicle: undefined;
  ManageRoutes: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Explore: undefined;
  Messages: undefined;
  Activity: undefined;
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

// ---------- Sender Tab Navigator ----------
function MainTabs() {
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
        tabBarStyle: { 
          backgroundColor: '#FFFFFF', 
          borderTopWidth: 1, 
          borderTopColor: '#E5E7EB', 
          height: 60, 
          paddingBottom: 8, 
          paddingTop: 2 
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Explore" component={ExploreScreen} />
      <Tab.Screen name="Messages" component={MessagesScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}

// ---------- Provider Tab Navigator ----------
function ProviderTabs() {
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
        tabBarStyle: { 
          backgroundColor: '#FFFFFF', 
          borderTopWidth: 1, 
          borderTopColor: '#E5E7EB', 
          height: 60, 
          paddingBottom: 8, 
          paddingTop: 2 
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        headerShown: false,
      })}
    >
      <ProviderTab.Screen name="Task" component={TaskScreen} />
      <ProviderTab.Screen name="Earnings" component={EarningsScreen} />
      <ProviderTab.Screen name="Jobs" component={JobsScreen} />
      <ProviderTab.Screen name="Messages" component={ProviderMessagesScreen} />
      <ProviderTab.Screen name="Account" component={ProviderAccountScreen} />
    </ProviderTab.Navigator>
  );
}

// ---------- App ----------
export default function App() {
  const appStateRef = useRef(AppState.currentState);
  const matcherCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    console.log('🚀 App starting...');
    
    // Start background matcher when app starts
    try {
      matcherCleanupRef.current = startBackgroundMatcher();
      console.log('✅ Background matcher started successfully');
    } catch (error) {
      console.error('❌ Failed to start background matcher:', error);
    }

    // Handle app state changes - restart matcher when app comes to foreground
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        console.log('📱 App came to foreground, restarting matcher...');
        
        // Stop existing matcher if any
        if (matcherCleanupRef.current) {
          try {
            matcherCleanupRef.current();
          } catch (error) {
            console.error('Error cleaning up matcher:', error);
          }
          matcherCleanupRef.current = null;
        }
        
        // Start new matcher
        try {
          matcherCleanupRef.current = startBackgroundMatcher();
          console.log('✅ Background matcher restarted successfully');
        } catch (error) {
          console.error('❌ Failed to restart background matcher:', error);
        }
      }
      appStateRef.current = nextAppState;
    });

    // Cleanup on unmount
    return () => {
      console.log('🛑 App unmounting, cleaning up...');
      if (matcherCleanupRef.current) {
        try {
          matcherCleanupRef.current();
        } catch (error) {
          console.error('Error during matcher cleanup:', error);
        }
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
        </Stack.Navigator>
      </NavigationContainer>
    </ScheduleProvider>
  );
}