import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  Ticket,
  PlusCircle,
  BookOpen,
  LayoutDashboard,
  Inbox,
  Users,
  Settings,
} from 'lucide-react-native';

import { supabase } from './src/lib/supabase';
import { COLORS } from './src/styles/theme';

import OnboardingScreen from './src/screens/auth/OnboardingScreen';
import LoginScreen from './src/screens/auth/LoginScreen';
import SignupScreen from './src/screens/auth/SignupScreen';

import TicketsListScreen from './src/screens/user/TicketsListScreen';
import CreateTicketScreen from './src/screens/user/CreateTicketScreen';
import TicketDetailScreen from './src/screens/user/TicketDetailScreen';
import KnowledgeBaseScreen from './src/screens/user/KnowledgeBaseScreen';
import UserProfileScreen from './src/screens/user/UserProfileScreen';
import { NotificationProvider } from './src/components/NotificationProvider';

import AdminDashboardScreen from './src/screens/admin/AdminDashboardScreen';
import AdminTicketsScreen from './src/screens/admin/AdminTicketsScreen';
import AdminTicketDetailScreen from './src/screens/admin/AdminTicketDetailScreen';
import AdminUsersScreen from './src/screens/admin/AdminUsersScreen';
import AdminSettingsScreen from './src/screens/admin/AdminSettingsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function UserTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tab.Screen
        name="Tickets"
        component={TicketsListScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Ticket size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="NewTicket"
        component={CreateTicketScreen}
        options={{
          title: 'New Ticket',
          tabBarIcon: ({ color, size }) => <PlusCircle size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="KnowledgeBase"
        component={KnowledgeBaseScreen}
        options={{
          title: 'Help Docs',
          tabBarIcon: ({ color, size }) => <BookOpen size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="UserSettings"
        component={UserProfileScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

function AdminTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tab.Screen
        name="AdminDashboard"
        component={AdminDashboardScreen}
        options={{
          title: 'Overview',
          tabBarIcon: ({ color, size }) => <LayoutDashboard size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="AdminTickets"
        component={AdminTicketsScreen}
        options={{
          title: 'Tickets',
          tabBarIcon: ({ color, size }) => <Inbox size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="AdminUsers"
        component={AdminUsersScreen}
        options={{
          title: 'Users',
          tabBarIcon: ({ color, size }) => <Users size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="AdminSettings"
        component={AdminSettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState('user');
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let mounted = true;

    const resolveRole = async (activeSession) => {
      if (!activeSession?.user?.id) {
        if (mounted) {
          setSession(null);
          setRole('user');
          setBooting(false);
        }
        return;
      }
      try {
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', activeSession.user.id)
          .single();
        if (mounted) {
          setSession(activeSession);
          setRole(data?.role || 'user');
        }
      } catch {
        if (mounted) {
          setSession(activeSession);
          setRole('user');
        }
      } finally {
        if (mounted) setBooting(false);
      }
    };

    supabase.auth.getSession().then(({ data }) => resolveRole(data?.session || null));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      resolveRole(nextSession);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  if (booting) {
    return (
      <SafeAreaProvider>
        <View style={styles.splash}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.splashText}>Loading HELPDESK.AI…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  const isAdmin = role === 'admin' || role === 'master_admin' || role === 'super_admin';

  return (
    <SafeAreaProvider>
      <NotificationProvider>
        <StatusBar style="dark" />
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {!session ? (
              <>
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="Signup" component={SignupScreen} />
                <Stack.Screen name="Onboarding" component={OnboardingScreen} />
              </>
            ) : isAdmin ? (
              <>
                <Stack.Screen name="AdminMain" component={AdminTabNavigator} />
                <Stack.Screen name="AdminTicketDetail" component={AdminTicketDetailScreen} />
              </>
            ) : (
              <>
                <Stack.Screen name="UserMain" component={UserTabNavigator} />
                <Stack.Screen name="TicketDetail" component={TicketDetailScreen} />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </NotificationProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#0b1f17',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  splashText: {
    color: '#d1fae5',
    fontSize: 14,
    fontWeight: '600',
  },
  tabBar: {
    backgroundColor: '#ffffff',
    borderTopColor: '#e7f5ee',
    borderTopWidth: 1,
    height: 64,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
});
