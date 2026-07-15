import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

// Import your screens
import LoadingScreen from './src/modules/Authentication/LoadingScreen';
import LoginScreen from './src/modules/Authentication/LoginScreen';
import RegisterScreen from './src/modules/Authentication/RegisterScreen';
import HomeScreen from './src/modules/Dashboard/Sender/HomeScreen';
import AccountScreen from './src/modules/Dashboard/Sender/AccountScreen';
import ExploreScreen from './src/modules/Dashboard/Sender/ExploreScreen';
import MessagesScreen from './src/modules/Dashboard/Sender/MessagesScreen';
import ActivityScreen from './src/modules/Dashboard/Sender/ActivityScreen';
import EditProfileScreen from './src/modules/Dashboard/Sender/EditProfileScreen';

// 👇 NEW: Import Schedule Context Provider
import { ScheduleProvider } from './src/modules/Dashboard/Sender/Delivery/ScheduleContext';

// 👇 NEW: Import Delivery Flow Screens
import DropoffTypeScreen from './src/modules/Dashboard/Sender/Delivery/DropoffTypeScreen';
import ShipmentSizeScreen from './src/modules/Dashboard/Sender/Delivery/ShipmentSizeScreen';
import AddItemScreen from './src/modules/Dashboard/Sender/Delivery/AddItemScreen';
import ScheduleCalendarScreen from './src/modules/Dashboard/Sender/Delivery/ScheduleCalendarScreen';
import LocationSelectScreen from './src/modules/Dashboard/Sender/Delivery/LocationSelectScreen';
import BookingScreen from './src/modules/Dashboard/Sender/Delivery/BookingScreen';
import DeliveryListScreen from './src/modules/Dashboard/Sender/Delivery/DeliveryListScreen';

// 👇 Define the navigation param list for Stack
export type RootStackParamList = {
  Loading: undefined;
  Login: undefined;
  Register: undefined;
  MainTabs: undefined;
  Account: undefined;
  EditProfile: undefined;
  // 👇 NEW: Delivery Flow Screens
  DropoffType: { mode: 'sendNow' | 'schedule'; editData?: any };
  ShipmentSize: undefined;
  AddItem: { size: 'Small' | 'Medium' | 'Large' };
  ScheduleCalendar: undefined;
  PickupLocation: { type: 'pickup'; initialCoords?: any };
  DropoffLocation: { type: 'dropoff'; initialCoords?: any };
  Booking: { mode: 'sendNow' | 'schedule' };
  DeliveryList: { status: 'Pending' | 'Accepted' };
};

// 👇 Define the navigation param list for Bottom Tabs
export type MainTabParamList = {
  Home: undefined;
  Explore: undefined;
  Messages: undefined;
  Activity: undefined;
  Account: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

// Bottom Tab Navigator
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: any;

          if (route.name === 'Home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Explore') {
            iconName = focused ? 'compass' : 'compass-outline';
          } else if (route.name === 'Messages') {
            iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          } else if (route.name === 'Activity') {
            iconName = focused ? 'time' : 'time-outline';
          } else if (route.name === 'Account') {
            iconName = focused ? 'person' : 'person-outline';
          }

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
          paddingTop: 2,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
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

export default function App() {
  return (
    // 👇 NEW: Wrap with ScheduleProvider
    <ScheduleProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Loading"
          screenOptions={{
            headerShown: false,
          }}
        >
          <Stack.Screen name="Loading" component={LoadingScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} />
          {/* 👇 NEW: Delivery Flow Screens */}
          <Stack.Screen name="DropoffType" component={DropoffTypeScreen} />
          <Stack.Screen name="ShipmentSize" component={ShipmentSizeScreen} />
          <Stack.Screen name="AddItem" component={AddItemScreen} />
          <Stack.Screen name="ScheduleCalendar" component={ScheduleCalendarScreen} />
          <Stack.Screen name="PickupLocation" component={LocationSelectScreen} />
          <Stack.Screen name="DropoffLocation" component={LocationSelectScreen} />
          <Stack.Screen name="Booking" component={BookingScreen} />
          <Stack.Screen name="DeliveryList" component={DeliveryListScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </ScheduleProvider>
  );
}